const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const { spawn } = require('child_process');

const axios = require('axios');

var AdmZip = require("adm-zip");

var Particle = require('particle-api-js');
var particle = new Particle();

var usb = require('particle-usb');

const BinaryVersionReader = require('binary-version-reader').HalModuleParser;
const binaryVersionReader = new BinaryVersionReader();

const winston = require('winston');

const Transport = require('winston-transport');

// SSE (Server Sent Events) is used to communicate between the node script
// and the web-based status page
class MySseTransport extends Transport {
    constructor(opts) {
        super(opts);
    }

    log(info, callback) {
        if (sse) {
            let obj = {
                op: 'log',
                level: info.level,
                msg: info.level + ': ' + info.message
            };
            sse.send(JSON.stringify(obj));    
        }
        callback();
    }
}

// Winston logger is used so logs can be written to the node console as well
// as the browser-based page. You could also save logs to a file here.
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [
        new winston.transports.Console(),
        new MySseTransport()
    ]
});

let config = require('./config');

const helper = require('@particle/node-example-helper');
helper
    .withRootDir(__dirname)
    .withConfig(config);
 
const hash = crypto.createHash('sha256');
hash.update(JSON.stringify(config));
const configHash = hash.digest('hex');


// The stagingDir is where we store temporary files
let stagingDir = config.stagingDir || './staging';
if (stagingDir.startsWith('./')) {
    stagingDir = path.join(__dirname, stagingDir.substr(2));
}
if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir);
}

let deviceLogsDir = config.deviceLogsDir || './deviceLogs';
if (deviceLogsDir.startsWith('./')) {
    deviceLogsDir = path.join(__dirname, deviceLogsDir.substr(2));
}
if (!fs.existsSync(deviceLogsDir)) {
    fs.mkdirSync(deviceLogsDir);
}

let savedData;

let savedDataPath = path.join(stagingDir, 'savedData.json');
if (fs.existsSync(savedDataPath)) {
    try {
        savedData = JSON.parse(fs.readFileSync(savedDataPath, 'utf-8'));

        if (savedData.configHash != configHash) {
            logger.info('config changed, recreating savedData');
            fs.rmdirSync(stagingDir, {recursive:true});
            fs.mkdirSync(stagingDir);
            savedData = null;
        }
    }
    catch(e) {
        logger.info('failed to load savedData, recreating');
    }
}
if (!savedData) {
    savedData = {
        configHash
    };
}

function saveSavedData() {
    fs.writeFileSync(savedDataPath, JSON.stringify(savedData, null, 2));
}

let eventStream;
let deviceNames = {};
let eventMonitors = [];

const connectEventStream = function () {
    if (eventStream) {
        return;
    }

    particle.getEventStream({ auth: helper.auth, product: config.productId }).then(function (stream) {
        eventStream = stream;
        stream.on('event', function (data) {
            try {
                // logger.info("Particle Event", data);
                let obj = {};

                if (deviceNames[data.coreid]) {
                    obj.deviceName = deviceNames[data.coreid];
                }
                obj.deviceId = data.coreid;
                obj.eventName = data.name;
                obj.publishedAt = data.published_at;
                try {
                    obj.eventData = JSON.parse(data.data);
                }
                catch (e) {
                    obj.eventData = data.data;
                }
                // console.log('particleEvent', obj);

                for(let ii = eventMonitors.length - 1; ii >= 0; ii--) {
                    if (eventMonitors[ii].deviceId == obj.deviceId) {
                        if (!eventMonitors[ii].eventName || eventMonitors[ii].eventName == obj.eventName) {
                            if (!eventMonitors[ii].eventData || eventMonitors[ii].eventData == obj.eventData) {
                                if (eventMonitors[ii].timer) {
                                    clearTimeout(eventMonitors[ii].timer);
                                    delete eventMonitors[ii].timer;
                                }
                                eventMonitors[ii].resolve(obj);
                                eventMonitors.splice(ii, 1);       
                            }
                        }
                    }
                }
            }
            catch(e) {
                console.log('exception in Particle event stream handler', e);
            }
        });
    }, 
    function (err) {
        logger.info('error opening event stream', err);
    });
}

function waitForEvent(options) {
    return new Promise(function(resolve, reject) {
        if (options.timeout) {
            options.timer = setTimeout(function() {
                reject();
            }, options.timeout);
        }

        eventMonitors.push(Object.assign({resolve}, options));
    });
}

var SSE = require('express-sse');
var sse = new SSE();

var publicPath = path.join(__dirname, 'public');

var express = require('express');
const { response } = require("express");

var app = express();

app.use(express.json());

// SSE event stream
app.get('/stream', sse.init);


app.use('/', express.static(publicPath));


let serverOptions = {

};

var server = http.createServer(serverOptions, app).listen(config.serverPort, 'localhost', function () {
    logger.info('server: http://localhost:' + config.serverPort + '/');
});


let dfuParts = [
    { name: 'system-part1' },
    { name: 'system-part2' },
    { name: 'system-part3' },
    { name: 'softdevice' },
    { name: 'firmware' },
    { name: 'bootloader' },
    {
        name: 'setup-done',
        alt: 1,
        startAddr: 0x1fc6
    },
    { 
        name: 'a5', 
        alt: 1,
        startAddr: 1753,
        leave: true
    }
];

let usbDeviceInfo = {}; 


async function run() {
    // Load required data
    try {
        await helper.authenticate();

        if (config.productId) {
            // Make sure user has access to it
            try {
                productInfo = await helper.getProductInfo(config.productId);
            }
            catch(e) {
                console.log('productId is configured in config.js but is invalid or you do not have access to it');
                helper.warnConfigKey('productId');
                process.exit(1);
            }
        }
        else {
            helper.warnConfigKey('productId');
            process.exit(1);
        }

        connectEventStream();
    
        if (!savedData.deviceRestoreInfo) {
            await new Promise((resolve, reject) => {
                axios.get('https://docs.particle.io/assets/files/deviceRestore.json')
                .then(response => {
                    // console.log('deviceRestoreInfo', response.data);
                    savedData.deviceRestoreInfo = response.data;
                    saveSavedData();
                    resolve();
                })
                .catch(error => {
                    console.log('error downloading deviceRestore.json', error);
                    reject();
                });
            });
        }
        
        if (!savedData.versionInfo) {
            await new Promise((resolve, reject) => {
                axios.get('https://docs.particle.io/assets/files/versionInfo.json')
                .then(response => {
                    // console.log('versionInfo', response.data);
                    savedData.versionInfo = response.data;
                    saveSavedData();
                    resolve();
                })
                .catch(error => {
                    console.log('error downloading versionInfo.json', error);
                    reject();
                });
            });
        }
        
        
        await new Promise((resolve, reject) => {
            particle.getProduct({ auth: helper.auth, product: config.productId }).then(
                function (data) {
                    productInfo = data.body.product;            
                    resolve();
                },
                function (err) {
                    logger.error('failed to retrieve product info (typically bad access token or product id)', err);
                    process.exit(1);
                }
            );
        });
    
        // Get all product firmware versions
        await new Promise((resolve, reject) => {
            particle.listProductFirmware({ auth: helper.auth, product: config.productId }).then(
                function (data) {
                    savedData.firmwareVersions = data.body;
                    savedData.defaultFirmwareVersion = 0;
    
                    for(const fv of savedData.firmwareVersions) {
                        if (fv.product_default) {
                            savedData.defaultFirmwareVersion = fv.version;
                        }
                    }

                    saveSavedData();

                    resolve();
                },
                function (err) {
                    logger.error('failed to retrieve product info (typically bad access token or product id)', err);
                    process.exit(1);
                }
            );
        });
    
        let userBinaryFileInfo;
    
        const firmwareBinaryPath = path.join(stagingDir, 'firmware.bin');
        if (!fs.existsSync(firmwareBinaryPath) || !savedData.moduleInfo || !savedData.moduleInfo['firmware']) {
            let firmwareVersion = config.firmwareVersion;
            if (!firmwareVersion) {
                firmwareVersion = savedData.defaultFirmwareVersion;
            }
            if (!firmwareVersion) {
                logger.error('config.firmwareVersion not set and no product default firmware.');
                process.exit(1);        
            }

            await new Promise((resolve, reject) => {
                particle.downloadProductFirmware({ auth: helper.auth, product: config.productId, version: firmwareVersion }).then(
                    function (data) {
                        logger.info('using firmware version ' + firmwareVersion);
            
                        fs.writeFileSync(firmwareBinaryPath, data);
    
                        binaryVersionReader.parseFile(firmwareBinaryPath, function (fileInfo, err) {
                            // console.log('fileInfo', fileInfo);
                            if (err) {
                                reject(err);
                                return;
                            }
    
                            userBinaryFileInfo = fileInfo;
                            // console.log('user firmware binary info', userBinaryFileInfo);
    
                            // Don't include the binary copy of the file in savedData
                            delete userBinaryFileInfo.fileBuffer;
    
                            // Is it in the semver table?
                            savedData.systemVersion = fileInfo.prefixInfo.depModuleVersion;
    
                            savedData.systemVersionSemVer = systemVersionToSemVer(savedData.systemVersion);
    
                            // Is it in the restore images?
    
                            savedData.restoreSemVer = findRestoreSemVer(fileInfo.prefixInfo.platformID, savedData.systemVersion);
                            // console.log('restoreSemVer=' + savedData.restoreSemVer);
                            if (!savedData.restoreSemVer) {
                                logger.info('Selected user binary file targets a Device OS version not supported by Device Restore');
                                reject('no device restore image');
                            }
    
                            if (savedData.systemVersionSemVer != savedData.restoreSemVer) {
                                logger.info('not an exact system match using ' + savedData.restoreSemVer + ' instead of ' + savedData.systemVersionSemVer);
                            }
    
                            for(let tempPlatformObj of savedData.deviceRestoreInfo.platforms) {
                                if (tempPlatformObj.id == fileInfo.prefixInfo.platformID) {
                                    savedData.platformInfo = tempPlatformObj;
                                    savedData.platformName = tempPlatformObj.name;
                                }
                            }

                            // console.log('restoreSemVer=' + savedData.restoreSemVer + ' platformName=' + savedData.platformName)
    
                            saveSavedData();
    
                            resolve();
                        });                    
                    },
                    function(err) {
                        logger.error('failed to download firmware version ' + firmwareVersion, err);
                        process.exit(1);        
                    }
                ); 
            });
        }
    
        if (!savedData.moduleInfo) {
            await new Promise((resolve, reject) => {
                const url = 'https://docs.particle.io/assets/files/device-restore/' + savedData.restoreSemVer + '/' + savedData.platformName + '.json';
                axios.get(url)
                .then(response => {
                    savedData.moduleInfo = response.data;
                    saveSavedData();
                    resolve();
                })
                .catch(error => {
                    logger.info('url=' + url);
                    logger.error('error downloading module info for version', error);
                    reject();
                });    
            });
    
            savedData.moduleInfo['firmware'] = userBinaryFileInfo;
            saveSavedData();
        }
    
    
    
        const restoreZipPath = path.join(stagingDir, 'restore.zip');
        if (!fs.existsSync(restoreZipPath)) {
            await new Promise((resolve, reject) => {
    
                axios.get('https://docs.particle.io/assets/files/device-restore/' + savedData.restoreSemVer + '/' + savedData.platformName + '.zip', {
                    responseType: 'arraybuffer',
                })
                .then(response => {
                    // console.log('restoreZip', response.data);
                    
                    fs.writeFileSync(restoreZipPath, response.data);
        
                    var zip = new AdmZip(restoreZipPath);            
                    zip.extractAllTo(stagingDir);

                    resolve();
                })
                .catch(error => {
                    logger.error('error downloading restore zip', error);
                });
            });
        }
    
        {
            {
                // Create the A5.bin file 
                const p = path.join(stagingDir, 'a5.bin');
                const buf = Buffer.alloc(1, 0xa5);
                fs.writeFileSync(p, buf);
            }
            {
                // Create the 01.bin file 
                const p = path.join(stagingDir, '01.bin');
                const buf = Buffer.alloc(1, 0x01);
                fs.writeFileSync(p, buf);
            }

            // Handle modules where prefix must be dropped (such as soft device)
            for(let ii = dfuParts.length - 1; ii >= 0; ii--) {
                partName = dfuParts[ii].name;
                if (savedData.moduleInfo[partName]) {
                    const prefixInfo = savedData.moduleInfo[partName].prefixInfo;
                
                    let binaryPath = path.join(stagingDir, dfuParts[ii].name + '.bin');
                    if ((prefixInfo.moduleFlags & 0x01) != 0) { // ModuleInfo.Flags.DROP_MODULE_INFO
                        // Drop module info is used for the Gen 3 softdevice
            
                        const tempPath = path.join(stagingDir, dfuParts[ii].name + '.noprefix.bin');
            
                        const binary = fs.readFileSync(binaryPath);
            
                        fs.writeFileSync(tempPath, binary.slice(24));
                
                        dfuParts[ii].binaryPath = tempPath;
                    }
                    else {
                        dfuParts[ii].binaryPath = binaryPath;
                    }
        
                    dfuParts[ii].alt = 0;
                    dfuParts[ii].startAddr = parseInt(prefixInfo.moduleStartAddy, 16);

                    if (partName == 'bootloader') {
                        if (savedData.platformInfo.gen == 3) {
                            dfuParts[ii].startAddr = 0x80289000; // OTA sectors
                            dfuParts[ii].alt = 2; // external flash
                        }
                        else {
                            dfuParts[ii].startAddr = 0x80C0000; // OTA sectors
                        }
                    }
                } 
                else 
                if (partName == 'setup-done') {
                    if (savedData.platformInfo.gen == 3) {
                        dfuParts[ii].binaryPath = path.join(stagingDir, '01.bin');
                    }
                    else {
                        dfuParts.splice(ii, 1);
                    }
                }
                else
                if (partName == 'a5') {
                    // Leave this even though there is no module info because we've
                    // set startAddr and alt above
                    dfuParts[ii].binaryPath = path.join(stagingDir, dfuParts[ii].name + '.bin');
                }
                else {
                    dfuParts.splice(ii, 1);
                }
        
            }
        }


    
    }
    catch(e) {
        logger.error('Failed initialization, exiting');
        console.log('exception', e);
        process.exit(1);
    }


    logger.info('Initialization complete, scanning USB now...');

    // Start scanning USB
    setInterval(async function () {
        const devices = await usb.getDevices();
        for (const device of devices) {
            try {
                await device.open();
    
                if (!usbDeviceInfo[device.id]) {
                    usbDeviceInfo[device.id] = {
                        disconnectWait: 8 * 1000 // 8 seconds
                    };
                }
                usbDeviceInfo[device.id].lastSeen = new Date();

                if (!usbDeviceInfo[device.id].checking) {
                    usbDeviceInfo[device.id].checking = true;
                    deviceCheck(device);
                }    
            }
            catch(e) {
                // Ignore failure to open, this happens when device is being used by dfu-util
            }
        }

        const now = Date.now();

        for(let curDeviceId in usbDeviceInfo) {
            // Find devices that have been disconnected and remove from the list
            if ((usbDeviceInfo[curDeviceId].lastSeen.getTime() + usbDeviceInfo[curDeviceId].disconnectWait) < now) {
                // console.log('expired ' + curDeviceId);
                messageToBrowser({
                    op: 'usbDisconnect',
                    id: curDeviceId
                });

                delete usbDeviceInfo[curDeviceId];
            }
        }

    }, config.usbScanPeriodMs);
    
}

run();


function systemVersionToSemVer(sysVer) {
    for(let obj of savedData.versionInfo.versions) {
        if (obj.sys == sysVer) {
            return obj.semVer;
        }
    }
    return null;
};

function semVerToSystemVersion(semVer) {
    for(let obj of savedData.versionInfo.versions) {
        if (obj.semVer == semVer) {
            return obj.sys;
        }
    }
    return 0;
};

function platformIdToName(platformId) {
    for(let tempPlatformObj of savedData.deviceRestoreInfo.platforms) {
        if (tempPlatformObj.id == platformId) {
            return tempPlatformObj.name;
        }
    }
    return null;
};

function findRestoreSemVer(platformId, sysVer) {
    const platformName = platformIdToName(platformId);

    const versionArray = savedData.deviceRestoreInfo.versionsZipByPlatform[platformName];
    if (!versionArray) {
        return null;
    }

    for(let ii = versionArray.length - 1; ii >= 0; ii--) {
        if (semVerToSystemVersion(versionArray[ii]) >= sysVer) {
            return versionArray[ii];
        }
    }
    return null;
};

let deviceList = [];
let productInfo;

const fetchPage = function (page) {
    particle.listDevices({ auth: helper.auth, product: config.productId, page }).then(
        function (data) {
            data.body.devices.forEach(function (dev) {
                deviceList.push(dev);

                if (dev.name) {
                    deviceNames[dev.id] = dev.name;
                }
            });

            if (page < data.body.meta.total_pages) {
                fetchPage(++page);
            }
            else {
                logger.info('product device list retrieved')
            }
        },
        function (err) {
            logger.error('failed to retrieve product device list', err);
            process.exit(1);
        }
    );
};

function deviceLogDir(deviceId) {
    const f = path.join(deviceLogsDir, deviceId);
    if (!fs.existsSync(f)) {
        fs.mkdirSync(f);
    }
    return f;
}

function deviceLogJson(deviceId, obj) {
    const f = path.join(deviceLogDir(deviceId), 'device.json');

    let oldObj = {};
    if (fs.existsSync(f)) {
        try {
            oldObj = JSON.parse(fs.readFileSync(f, 'utf8'));
        }
        catch(e) {            
        }
    }

    newObj = Object.assign(oldObj, obj);

    fs.writeFileSync(f, JSON.stringify(newObj, null, 2));
}

function deviceLogBrowser(id, msg) {
    let obj = {
        op: 'deviceLog',
        id,
        msg
    };
    sse.send(JSON.stringify(obj));

    console.log(id + ': ' + msg);

    // Also log to to the device-specific log file
    const f = path.join(deviceLogDir(id), 'log.txt');
    const ts = new Date().toISOString();
    fs.writeFileSync(f, ts + ': ' + msg + '\n', {flag:'a+'});
};

function messageToBrowser(msg) {
    sse.send(JSON.stringify(msg));
}

function setDeviceInfoBrowser(id, info) {
    let obj = {
        op: 'deviceInfo',
        id,
        info
    };
    sse.send(JSON.stringify(obj));
};

// From particle-iot/device-os-flash-util, util.js
async function execCommand(cmd, args, { timeout = 0 } = {}) {
	return new Promise((resolve, reject) => {
		let proc = spawn(cmd, args, {
			stdio: [
				'ignore', // stdin
				'pipe', // stdout
				'pipe' // stderr
			]
		});
		const onExit = () => {
			if (proc) {
				proc.kill();
			}
		};
		process.once('exit', onExit);
		let timer = null;
		if (timeout) {
			timer = setTimeout(() => {
				if (proc) {
					const p = proc;
					proc = null;
					process.off('exit', onExit);
					p.kill();
					reject(new Error(`${cmd} has timed out`));
				}
			}, timeout);
		}
		let stdout = '';
		let stderr = '';
		let output = ''; // Combined output
		proc.stdout.on('data', d => {
			stdout += d;
			output += d;
		});
		proc.stderr.on('data', d => {
			stderr += d;
			output += d;
		});
		proc.once('exit', (exitCode, signal) => {
			if (proc) {
				proc = null;
				process.off('exit', onExit);
				if (timer) {
					clearTimeout(timer);
				}
				if (signal) {
					reject(new Error(`${cmd} was terminated by ${signal}`));
				} else {
					resolve({ exitCode, stdout, stderr, output });
				}
			}
		});
		proc.once('error', err => {
			if (proc) {
				proc = null;
				process.off('exit', onExit);
				if (timer) {
					clearTimeout(timer);
				}
				reject(new Error(`${cmd} process error: ${err.message}`));
			}
		});
	});
}


async function flashFirmware(device) {
    
    // TODO: Implement ESP32 NCP on Tracker with 3.0.0 and later

    const deviceId = device.id;

    usbDeviceInfo[deviceId].disconnectWait = config.flashTimeout;

    const toUInt16Hex = function(num) {
        return '0x' + num.toString(16).padStart(4, '0');
    }

    const toUInt32Hex = function(num) {
        return '0x' + num.toString(16).padStart(8, '0');
    }

    // 
    while(!device.isInDfuMode) {
        deviceLogBrowser(deviceId, 'entering DFU mode');
        
        device.enterDfuMode();
        device.close();

        await new Promise(resolve => setTimeout(() => resolve(), 2000));                

        device = await usb.openDeviceById(deviceId);
    }

    for(const dfuPart of dfuParts) {
        partName = dfuPart.name;

        deviceLogBrowser(deviceId, 'flashing ' + partName);


        let args = [];
        
        const vidPid = toUInt16Hex(device.vendorId) + ':' + toUInt16Hex(device.productId);
        args.push('-d', vidPid);

        if (process.platform === 'linux') {
            const d = device.usbDevice._dev; // FIXME
            const busPort = d.busNumber.toString() + '-' + d.portNumbers.join('.');    
            args.push('-p', busPort);
        }
        else {
            args.push('-S', deviceId);
        }

        args.push('-a', dfuPart.alt.toString());

        args.push('-s', toUInt32Hex(dfuPart.startAddr) + (dfuPart.leave ? ':leave' : ''));

        args.push('-D', dfuPart.binaryPath);

        // console.log('args', args);


        await device.close();

        const res = await execCommand('dfu-util', args, { timeout: config.flashTimeout });

        {
            const f = path.join(deviceLogDir(deviceId), 'dfu-' + partName + '.txt');
            const ts = new Date().toISOString();         
            fs.writeFileSync(f, ts + ':\n' + res.output + '\n\n', {flag:'a+'});    
        }
    
        // console.log('res', res);

        for(let tries = 0; tries < 10; tries++) {
            try {
                // Reopen device
                device = await usb.openDeviceById(deviceId);

                break;
            }
            catch(e) {

                await new Promise(resolve => setTimeout(() => resolve(), 2000));                
            }
        
        }

        usbDeviceInfo[deviceId].lastSeen = new Date();

        if (res.exitCode) {
            // failed to flash part
            deviceLogBrowser(deviceId, 'flashing ' + partName + ' by DFU failed');
            throw 'DFU flash failed';
        }
        
    }


    deviceLogJson(deviceId, {
        flashSuccess: true
    });

    deviceLogBrowser(deviceId, 'flash firmware done!');

    usbDeviceInfo[deviceId].disconnectWait = 8 * 1000; // 8 seconds
}

async function deviceCheck(device) {
    const deviceId = device.id;

    if (device.platformId != productInfo.platform_id) {
        logger.info('wrong type of device, ignoring ' + deviceId);
        return;
    }


    deviceLogBrowser(deviceId, 'connected by USB');

    try {
        let res;

        // Add to product. Do this always because it's fast and also takes care of the situation
        // where the device is already in quarantine.
        res = await particle.addDeviceToProduct({ auth: helper.auth, product: config.productId, deviceId: deviceId });
        if (res.statusCode != 200) {
            deviceLogBrowser(deviceId, 'failed to add to product');
            return;
        }

        deviceLogBrowser(deviceId, 'added to product');

        // Get additional information (name, serial number, etc)
        res = await particle.getDevice({ auth: helper.auth, product: config.productId, deviceId: deviceId });
        if (res.statusCode != 200) {
            deviceLogBrowser(deviceId, 'failed get device info');
            return;
        }
    
        let deviceInfo = res.body;
        setDeviceInfoBrowser(deviceId, deviceInfo);

        // Activate SIM for Electron?
    
            
        if (config.claimDevice) {
            deviceLogBrowser(deviceId, 'claiming device');
            await particle.claimDevice({ 
                deviceId, 
                auth: helper.auth 
            });

            deviceLogJson(deviceId, {
                claimDevice: helper.userInfo.username
            });        
        }

        let newDeviceInfo = {};

        if (config.markAsDevelopment) {
            newDeviceInfo.development = true;
        }
        if (config.deviceNameIsSerialNumber) {
            newDeviceInfo.name = deviceInfo.serial_number;
            deviceNames[deviceId] = newDeviceInfo.name;
        }
        if (config.lockFirmwareVersion) {
            newDeviceInfo.desiredFirmwareVersion = config.lockFirmwareVersion;

            if (config.flashNow) {
                newDeviceInfo.flash = config.flashNow;
            }
        }

        if (Object.keys(newDeviceInfo).length > 0) {
            deviceLogBrowser(deviceId, 'setting device info');
            await particle.updateDevice(Object.assign(newDeviceInfo, { 
                product: productInfo.id,
                deviceId, 
                auth: helper.auth 
            }));
        }

        // Device group?
        if (config.deviceGroupName || config.deviceGroupFormat) {
            let groupName;
            if (config.deviceGroupName) {
                groupName = config.deviceGroupName;
            }
            else {
                switch(config.deviceGroupFormat) {
                    case 'date':
                        groupName = helper.formatDateYYYYMMDD();
                        break;

                    case 'dateQuantity':
                        groupName = helper.formatDateYYYYMMDD() + '_' + importSize;
                        break;
                }
            }

            if (groupName) {
                deviceLogBrowser(deviceId, 'assigning device group');
                await helper.assignDeviceGroups({ 
                    product: productInfo.id,
                    deviceId,
                    groups: [groupName],
                    auth: helper.auth
                });    
                deviceLogJson(deviceId, {
                    deviceGroup: groupName
                });        
            }
        }        

        deviceInfo = (await particle.getDevice({ 
            product: productInfo.id,
            deviceId, 
            auth: helper.auth 
        })).body;
        
        deviceLogJson(deviceId, {deviceInfo});

        setDeviceInfoBrowser(deviceId, deviceInfo);

        if (config.flashFirmware) {
            // Flash firmware
            await flashFirmware(device);
        }
    

        /*
        if (config.checkModuleInfo) {
            deviceLogBrowser(deviceId, 'entering listening mode');

            for(let tries = 0; tries < 10; tries++) {
                if (device.getDeviceMode() == 'LISTENING') {
                    break;
                }
                try {
                    device.enterListeningMode();
                }
                catch(e) {
                    device = await usb.openDeviceById(deviceId);
                }

                await new Promise(resolve => setTimeout(() => resolve(), 2000));                
            }

            // 
        }
        */

        // Log serial inspect output

        // Monitor output from test firmware

        // Flash real firmware?


        //
        if (config.waitDeviceOnline) {
            deviceLogBrowser(deviceId, 'waiting for device online');

            await waitForEvent({
                timeout: 10 * 60 * 1000, // 10 minutes
                eventName: 'spark/status',
                eventData: 'online',
                deviceId
            });

            deviceLogJson(deviceId, {online: true});
        }
        

        deviceLogBrowser(deviceId, 'setup done!');

        messageToBrowser({
            op: 'setupDone',
            id: deviceId
        });

    }
    catch(e) {
        deviceLogBrowser(deviceId, 'Exception flashing device');

        messageToBrowser({
            op: 'setupFailed',
            id: deviceId
        });

        console.log('exception', e);
    }


}