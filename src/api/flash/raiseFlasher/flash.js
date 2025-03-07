/* bazecor-flash-raise -- Dygma Raise flash helper for Bazecor
 * Copyright (C) 2019, 2020  DygmaLab SE
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <http://www.gnu.org/licenses/>.
 */

import { ipcRenderer } from "electron";
import fs from "fs";
import path from "path";
import log from "electron-log/renderer";
import Focus from "../../focus";
import Hardware from "../../hardware";
import { delay } from "../../../main/utils/delay";
import formatedDate from "../formatedDate";
import { arduino } from "./arduino-flasher";

/**
 * Create a new flash raise object.
 * @class FlashRaise
 * @param {object} port - serial port object for the "path"
 * @param {object} device - device data from SerailPort.list()
 * @property {object} backupFileData Object with settings from raise keyboard EEPROM, logging data, keyboard serial number and file with firmware
 * @emits backupSettings
 * @emits resetKeyboard
 * @emits updateFirmware
 */
export class FlashRaise {
  constructor(device) {
    this.device = device;
    this.currentPort = null;
    this.backupFileName = null;
    this.backupFileData = {
      backup: {},
      log: ["Neuron detected"],
      serialNumber: device.serialNumber,
      firmwareFile: "File has not being selected",
    };
    this.backup = [];
  }

  /**
   * Founds device what connected from Bazecor Hardware api.
   * @param {array} hardware - Array of supported devices by Bazecor api.
   * @param {string} message - Message for backup file.
   * @returns {boolean} if device found - true, if no - false
   */
  async foundDevices(hardware, message, bootloader) {
    const focus = Focus.getInstance();
    let isFindDevice = false;
    log.info("looking at device", this.device, hardware);
    await focus.find(...hardware).then(devices => {
      for (const device of devices) {
        log.info(
          "DATA CHECKER: ",
          device,
          this.device,
          device.device.bootloader,
          bootloader,
          this.device.info.keyboardType,
          device.device.info.keyboardType,
        );
        if (
          bootloader
            ? device.device.bootloader !== undefined &&
              device.device.bootloader === bootloader &&
              this.device.info.keyboardType === device.device.info.keyboardType
            : this.device.info.keyboardType === device.device.info.keyboardType
        ) {
          log.info(message);
          this.currentPort = { ...device };
          isFindDevice = true;
        }
      }
    });
    return isFindDevice;
  }

  /**
   * Takes backup settings from keyboard and writes its in backupfile.
   */
  async backupSettings() {
    const focus = Focus.getInstance();

    const commands = [
      "hardware.keyscan",
      "led.mode",
      "keymap.custom",
      "keymap.default",
      "keymap.onlyCustom",
      "led.theme",
      "palette",
      "colormap.map",
      "macros.map",
      "settings.defaultLayer",
      "led.brightness",
      "idleleds.time_limit",
      "qukeys.holdTimeout",
      "qukeys.overlapThreshold",
      "mouse.speed",
      "mouse.speedDelay",
      "mouse.accelSpeed",
      "mouse.accelDelay",
      "mouse.wheelSpeed",
      "mouse.wheelDelay",
      "mouse.speedLimit",
      "mouse.speedDelay",
      "superkeys.map",
      "superkeys.holdstart",
      "superkeys.waitfor",
      "superkeys.timeout",
      "superkeys.repeat",
      "superkeys.overlap",
    ];
    this.backupFileName = `Raise-backup-${formatedDate()}.json`;

    try {
      let errorFlag = false;
      const errorMessage = "Firmware update failed, because the settings could not be saved";
      for (const command of commands) {
        // Ignore the command if it's not supported
        if (!focus.isCommandSupported(command)) {
          continue;
        }

        const res = await focus.command(command);
        this.backupFileData.backup[command] = typeof res === "string" ? res.trim() : res;
        if (res === undefined || res === "") {
          errorFlag = true;
        }
      }
      if (errorFlag) throw new Error(errorMessage);
    } catch (e) {
      this.saveBackupFile();
      throw e;
    }
  }

  /**
   * Saves backup file in directory:
   * windows: C:\Users\<Your_User_Namer>\AppData\Local\Programs\bazecor,
   * linux: in directory, where the app is located.
   */
  async saveBackupFile() {
    const userDataPath = await ipcRenderer.invoke("get-userPath", "userData");
    const route = path.join(userDataPath, this.backupFileName + ".json");
    log.info("saving file to: " + route);
    fs.writeFile(route, JSON.stringify(this.backupFileData), err => {
      if (err) throw err;
    });
  }

  /**
   * Returns a Promise to be awaited that sets the DTR flag of the port
   * @param {*} port Port to be used on the set dtr function
   * @param {*} state State of the DTR flag to be set on the port
   * @returns {promise} that will resolve when the function has successfully setted the DTR flag
   */
  setDTR = (port, state) =>
    new Promise((resolve, reject) => {
      port.set({ dtr: state }, () => {
        log.info(`DTR set to ${state} at ${new Date(Date.now()).toISOString()}`);
        resolve();
      });
    });

  /**
   * Update the baud rate of the port with a Promise
   * @param {*} port Port to be updated
   * @param {*} baud BaudRate to be set
   * @returns {promise} Promise to be returned, that will resolve when the operation is done
   */
  updatePort = (port, baud) =>
    new Promise((resolve, reject) => {
      port.update({ baudRate: baud }, () => {
        log.info(`Port update started at: ${new Date(Date.now()).toISOString()}`);
        resolve();
      });
    });

  /**
   * Resets keyboard at the baud rate of 1200bps. Keyboard is restarted with the bootloader
   * @param {object} port - serial port object for the "path".
   * @returns {promise}
   */
  resetKeyboard(port, stateUpdate) {
    stateUpdate("reset", 5);
    log.info("reset start", port);
    const errorMessage =
      "The firmware update couldn't start because the Raise Bootloader wasn't found. Please check our Help Center for more details or schedule a video call with us.";
    const timeouts = {
      dtrToggle: 1000, // Time to wait (ms) between toggling DTR
      waitingClose: 2000, // Time to wait for boot loader
      bootLoaderUp: 1000, // Time to wait for the boot loader to come up
    };
    return new Promise(async (resolve, reject) => {
      stateUpdate("reset", 10);
      await this.updatePort(port, 1200);
      log.info("resetting neuron");
      await this.setDTR(port, true);
      await delay(timeouts.dtrToggle);
      await this.setDTR(port, false);
      stateUpdate("reset", 20);
      log.info("waiting for bootloader");
      try {
        await delay(timeouts.waitingClose);
        let bootCount = 6;
        while (bootCount > 0) {
          stateUpdate("reset", 20 + (10 - bootCount) * 8);
          if (await this.foundDevices(Hardware.bootloader, "Bootloader detected", true)) {
            resolve("Detected Bootloader mode");
            bootCount = true;
            stateUpdate("reset", 100);
            break;
          }
          await delay(timeouts.bootLoaderUp);
          bootCount--;
        }
        if (bootCount != true) {
          stateUpdate("reset", 100);
          reject(errorMessage);
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Updates firmware of bootloader
   * @param {object} port - serial port object for the "path".
   * @param {string} filename - path to file with firmware.
   * @returns {promise}
   */
  async updateFirmware(filename, stateUpdate) {
    await this.foundDevices(Hardware.bootloader, "Bootloader detected", true);
    const focus = Focus.getInstance();
    log.info("Begin update firmware with arduino-flasher", this.currentPort);
    // log.info(JSON.stringify(focus));
    return new Promise(async (resolve, reject) => {
      try {
        if (focus.closed) {
          await focus.open(this.currentPort.path, this.currentPort.device);
        }

        stateUpdate("neuron", 0);
        await arduino.flash(filename, stateUpdate, async (err, result) => {
          if (err) throw new Error(`Flash error ${result}`);
          else {
            stateUpdate("neuron", 100);
            log.info("End update firmware with arduino-flasher");
            await delay(1500);
            await this.detectKeyboard();
            resolve();
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Detects keyboard after firmware of bootloader
   */
  async detectKeyboard() {
    const timeouts = 2500; // time to wait for keyboard
    const findTimes = 5;
    const errorMessage =
      "The firmware update has failed during the flashing process. Please unplug and replug the keyboard and try again";
    log.info("Waiting for keyboard");
    // wait until the bootloader serial port disconnects and the keyboard serial port reconnects
    const findKeyboard = async () =>
      new Promise(async resolve => {
        await delay(timeouts);
        if (await this.foundDevices(Hardware.serial, "Keyboard detected", false)) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    try {
      await this.runnerFindKeyboard(findKeyboard, findTimes, errorMessage);
    } catch (e) {
      log.error(`Detect keyboard: Error: ${e.message}`);
      throw e;
    }
  }

  /**
   * Runs the function several times
   * @param {function} findKeyboard - function that will run several times.
   * @param {number} times - how many times function runs.
   * @param {string} errorMessage - error message if error is.
   */
  async runnerFindKeyboard(findKeyboard, times, errorMessage) {
    if (!times) {
      log.error(errorMessage);
      return false;
    }
    if (await findKeyboard()) {
      log.info("Ready to restore");
      return true;
    }
    log.info(`Keyboard not detected, trying again for ${times} times`);
    await this.runnerFindKeyboard(findKeyboard, times - 1, errorMessage);
  }

  /**
   * Restores settings to keyboard after bootloader flashing
   */
  async restoreSettings(backup, stateUpdate) {
    stateUpdate("restore", 0);
    let focus = Focus.getInstance();
    const errorMessage = "Firmware update failed, because the settings could not be restored";
    log.info(backup);
    if (backup === undefined || backup.length === 0) {
      this.foundDevices();
      await focus.open(this.currentPort.path, this.currentPort.device.info);
      return true;
    }
    try {
      await focus.open(this.currentPort.path, this.currentPort.device.info);
      for (let i = 0; i < backup.length; i++) {
        let val = backup[i].data;
        // Boolean values need to be sent as int
        if (typeof val === "boolean") {
          val = +val;
        }
        log.info(`Going to send ${backup[i].command} to keyboard`);
        await focus.command(`${backup[i].command} ${val}`.trim());
        stateUpdate("restore", (i / backup.length) * 90);
      }
      await focus.command("led.mode 0");
      stateUpdate("restore", 100);
      return true;
    } catch (e) {
      return false;
    }
  }
}
