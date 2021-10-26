# node-example-device-flash-setup

*Example script for programming devices by USB and setting up cloud settings*

- This script is a preliminary beta version provided as a starting point for your own manufacturing script
- Familiarity with node.js is recommended for customization and troubleshooting


## Features

- Detect and program multiple Particle devices connected by USB to a single computer
- Flashes over USB (DFU mode)
- Does cloud setup of device (like [node-example-device-cloud-setup](https://github.com/particle-iot/node-example-device-cloud-setup))
- Easily customizable node.js server
- Web interface to show programming status of multiple devices concisely

### Firmware flash (optional)

- Device OS
- Bootloader
- Softdevice (Gen 3)
- User firmware

### Cloud setup features (optional)

- Add the device to a product
- Claim the device to an account
- Set the product firmware version (and optionally flash now)
- Set as development device (optional; not typically used)
- Set the device name to the serial number (optional)
- Add a device group, either fixed name or date-based


## Installation

Unlike most of the node-example scripts, this script can only be run locally in node, not from a browser using Stackblitz. The reason is that your web browser doesn't provide automatic access to all USB devices for security reasons, so there's no way to auto-detect new devices and program them from a browser.

- You must have dfu-util installed. The easiest way is to install the [Particle CLI](https://docs.particle.io/cli/), but the CLI itself isn't used.

- If you don't have [node.js](https://nodejs.org/) version 12 or later installed, do that first. At the time of writing, the current LTS version is 14.17.6 but whatever is the latest LTS (long-term support) version is recommended.

- Download the files for this project from the [Github repository](https://github.com/particle-iot/node-example-device-flash-setup) if you have not already done so.

- From a Command Prompt or Terminal window, install the dependencies:

```
npm install
```

- **Edit the configuration file** config.js (see the following section). There are required parameters you must edit in this file!

- Run the script

```
node app.js
```

- Follow the instructions in the terminal window. For example, if you have not put an access token in the configuration file you will need to log in interactively. Logging in interactively is generally more secure.

- Open a web browser on the same computer as you are running node to: http://localhost:5222/ . This is optional, but the display is much easier to follow on the browser-based status display when you're programming multiple devices. For security reasons, you can only connect to the web UI from the computer that is running node.js.

- Connect device(s) to the computer by USB.

- The status will update both in the node console log (where you ran `node app.js`) and also in the browser. It may take up to 5 seconds for a new devices to be detected.

- You can connect multiple devices to the same computer by USB and it will update them all at the same time. 

## Customizing behavior

There are many configurable settings in the config.js file. There are extensive instruction as comments
in the file. You will need to 

If you edit the file and the apps is running, stop it (Ctrl-C), then start it again (`node app.js`) to re-read the configuration file. The web interface will automatically reconnect in a few seconds after restarting the node server.

For example, you must edit the config.productId line to be a valid product ID that you have access to:

```
// You must set this to be the productId of the product you want
// to onboard devices for.
config.productId = 1234;
```    

## Firmware flash

The script by default flashes the current product default firmware for the product ID you have configured with `config.productId`. You can also choose a different version, and also lock the firmware for a device to that version.

Important note: You should only target Device OS versions that are included in the [hex generator](https://docs.particle.io/tools/device-programming/hex-generator/) application. If you target a different version, then the next higher version will be used to flash the device. For example, if you target 1.5.1, then Device OS 1.5.2 will be flashed to your device but your application will still target 1.5.1. It should run correctly in this configuration.


## Code Overview

- config.js - The configuration file that you need to modify.
- app.js - The main application.
- public - Folder that contains the HTML, Javascript, and CSS for the web-based status interface.
- staging - The directory where Device OS and firmware binaries are stored, along with other metadata
- deviceLogs - Per device information saved while configuring the device
- settings.json - This file is where settings from interactive configuration is saved. Currently,
this is only the access token when using interactive login with saving access token is enabled.


## Version History

- Repository: https://github.com/particle-iot/node-example-device-flash-setup
- License: Apache 2.0


### 0.0.1 (2021-10-25)

- Initial version


