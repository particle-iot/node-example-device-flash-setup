const { configure } = require("winston");

(function(config) {
    // You must set this to be the productId of the product you want
    // to onboard devices for.
    config.productId = 0;

    // Set to true to flash user firmware and Device OS to the device
    // by USB. If false or not set, then only the cloud-based setup
    // steps are done.
    config.flashFirmware = true;

    // Force a specific version of Device OS instead of deriving it
    // from the user firmware binary
    // config.forceSystemVersion = '3.1.0';

    // Version of the firmware to flash by USB. Leave unset to flash
    // the default product firmware. Normally you should use the product
    // default unless you are using lockFirmwareVersion, otherwise when
    // the device connects to the cloud it will immediately get a 
    // another firmware update from the cloud.
    // config.firmwareVersion = 1;

    // Lock the firmware to the specified version. If not set, then the 
    // product default is used.
    // config.lockFirmwareVersion = 1;

    // Flash the firmware now. Only used if lockFirmwareVersion is non-zero.
    // This is generally not necessary, because the device will be typically 
    // be offline when this command is issued, and also presumably because
    // you just flashed the firmware by USB.
    // config.flashNow = false;

    // If the device is a tracker and the version being installed is 
    // 3.0.0 or later, flash the NCP. This is required for factory
    // devices with 1.5.x or 2.x on them, so the default is true.
    // This adds some time to the upgrade and an additional reboot
    // so there is an option to turn it off if you know the device
    // contains 3.0.0 or later already.
    config.flashTrackerNCP = true;

    // Set this to true to claim the device to the user who is logged in.
    // This user must be a team member of the product. Set to false or 
    // leave unset to not claim the device (leave as unclaimed product
    // device).
    config.claimDevice = true;

    // Mark as development device. Not typically how product devices are
    // configured, but an option. Requires that the device be claimed.
    // config.markAsDevelopment = false;

    // Set the device name to be the serial number. Optional if you
    // don't want to set all of the device names, or leave them blank.
    config.deviceNameIsSerialNumber = true;

    // If you want to assign a specific device group name, enter that here:
    // Note: device group name cannot contain spaces! Leave this unset if
    // using deviceGroupFormat
    // config.deviceGroupName = '';

    // If you want to assign a device group with a programmatically, set deviceGroupFormat to
    // one of these options:
    config.deviceGroupFormat = 'date'; // YYYYMMDD
    // config.deviceGroupFormat = 'dateQuantity'; // YYYYMMDD_nnn where nnn is the number of devices in the device list file

    // True to check if the device comes online successfully after flashing
    config.waitDeviceOnline = true;

    // This is the port to listen on for the interactive web interface.
    // The listening port is only bound to localhost, so you can't access the
    // status web page from any location other than the computer running
    // the node.js script.
    config.serverPort=5222;

    // This is the directory to store firmware and Device OS files prior to flashing.
    // If it begins with './' it will be relative to the node application directory.
    config.stagingDir='./staging';

    // This is the directory to save the per-device log files from onboarding
    // If it begins with './' it will be relative to the node application directory.
    config.deviceLogsDir='./deviceLogs';

    // The maximum amount of time a DFU flash should take
    config.flashTimeout = 2 * 60 * 1000; // 2 minutes

    // How often to scan USB. Default: 5 seconds in milliseconds.
    config.usbScanPeriodMs = 5000;

    // Setting an auth token here is optional. If you do not set the auth token
    // here, you'll be prompted for it interactively, which is more secure.
    // config.auth = 'xxxx';

    // If you prompt for the authentication code, this is how long the token
    // should be valid in seconds. 3600 = 1 hour, 36000 = 10 hours. Make sure
    // the token will not run out while you are running the script, as it
    // is used for cloud setup.
    config.authTokenLifeSecs = 36000;

    // If you are using interactive login, you can temporarily save the token
    // in the settings.json file so you don't have to log in every time you
    // run the tool.
    config.saveInteractiveToken = true;

}(module.exports));


