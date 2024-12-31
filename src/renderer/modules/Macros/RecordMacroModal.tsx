/* eslint-disable no-continue */
/* eslint-disable no-nested-ternary */
import React, { useCallback, useEffect, useRef, useState } from "react";
import log from "electron-log/renderer";
import { ipcRenderer } from "electron";
import { i18n } from "@Renderer/i18n";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@Renderer/components/atoms/Dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@Renderer/components/atoms/Tooltip";
import { Button } from "@Renderer/components/atoms/Button";
import {
  IconRecord,
  IconArrowInBoxDown,
  IconPause,
  IconUndoRestart,
  IconStopWatch,
  IconStopwatchCrossed,
} from "@Renderer/components/atoms/icons";
import Heading from "@Renderer/components/atoms/Heading";
import AnimatedTimelineRecording from "./AnimatedTimelineRecording";
import { KeymapDB } from "../../../api/keymap";
import { translator } from "./utils";

interface Props {
  onAddRecorded: (recorded: any) => void;
}

interface Record {
  char: string | JSX.Element;
  keycode: number;
  action: number;
  time: number;
  isMod: boolean;
}

const RecordMacroModal = (props: Props) => {
  const { onAddRecorded } = props;
  const buttonRecord = React.createRef<HTMLButtonElement>();
  const [keymapDB] = useState(new KeymapDB());
  const [showModal, setShowModal] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recorded, setRecorded] = useState([]);
  const [recLength, setRecLength] = useState(0);
  const isDelayActive = useRef(false);
  const recording = useRef([]);

  const recordKeyDown = useCallback(
    (event: Electron.IpcRendererEvent, response: any) => {
      log.info("Check key-down", response);
      const newRecorded: Record[] = recording.current;
      const translated = keymapDB.parse(translator[response.event.keycode]);
      log.info("key press", translated);
      if (isDelayActive.current && recording.current.length > 0) {
        const timePast = response.time - recording.current[recording.current.length - 1].time;
        if (timePast !== undefined && timePast > 1)
          newRecorded.push({
            char: "delay",
            keycode: timePast,
            action: 2,
            time: response.time,
            isMod: translated.keyCode >= 224 && translated.keyCode <= 231,
          });
      }
      newRecorded.push({
        char: translated.label,
        keycode: translated.keyCode,
        action: 6,
        time: response.time,
        isMod: translated.keyCode >= 224 && translated.keyCode <= 231,
      });
      recording.current = newRecorded;
      setRecLength(recording.current.length);
    },
    [keymapDB],
  );

  const recordKeyUp = useCallback(
    (event: Electron.IpcRendererEvent, response: any) => {
      log.info("Check key-up", response);
      const newRecorded = recording.current;
      const translated = keymapDB.parse(translator[response.event.keycode]);
      log.info("key release", translated);
      if (isDelayActive.current) {
        const timePast = response.time - recording.current[recording.current.length - 1].time;
        if (timePast !== undefined && timePast > 1)
          newRecorded.push({
            char: "delay",
            keycode: timePast,
            action: 2,
            time: response.time,
            isMod: translated.keyCode >= 224 && translated.keyCode <= 231,
          });
      }
      newRecorded.push({
        char: translated.label,
        keycode: translated.keyCode,
        action: 7,
        time: response.time,
        isMod: translated.keyCode >= 224 && translated.keyCode <= 231,
      });
      recording.current = newRecorded;
      setRecLength(recording.current.length);
    },
    [keymapDB],
  );

  useEffect(() => {
    ipcRenderer.on("recorded-key-down", recordKeyDown);
    ipcRenderer.on("recorded-key-up", recordKeyUp);
    // ipcRenderer.on("recorded-mouse-move", (event, response) => {
    //   log.info(response);
    // });
    // ipcRenderer.on("recorded-mouse-click", (event, response) => {
    //   log.info(response);
    // });
    // ipcRenderer.on("recorded-mouse-wheel", (event, response) => {
    //   log.info(response);
    // });

    return () => {
      ipcRenderer.off("recorded-key-down", recordKeyDown);
      ipcRenderer.off("recorded-key-up", recordKeyUp);
      // ipcRenderer.removeAllListeners("recorded-mouse-move");
      // ipcRenderer.removeAllListeners("recorded-mouse-click");
      // ipcRenderer.removeAllListeners("recorded-mouse-wheel");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const data = recording.current.map(item => {
      let newItem = item.char;
      if (item.action === 2) return "";
      if (item.action === 6) newItem += "↓";
      if (item.action === 7) newItem += "↑";
      return newItem;
    });
    setRecorded(data);
  }, [recLength]);

  const setRecordingState = (isR: boolean) => {
    setIsRecording(isR);
  };

  const undoRecording = () => {
    setRecLength(recLength + 1);
    recording.current = [];
  };

  const setDelayOn = () => {
    setRecLength(recLength + 1);
    isDelayActive.current = true;
  };

  const setDelayOff = () => {
    setRecLength(recLength + 1);
    isDelayActive.current = false;
  };

  const toggleShow = () => {
    recording.current = [];
    setShowModal(!showModal);
  };

  const toggleIsRecording = async () => {
    if (buttonRecord.current && buttonRecord.current instanceof HTMLButtonElement) {
      buttonRecord.current.blur();
    }
    const isAccessible = await ipcRenderer.invoke("ask-for-accessibility", "");
    if (!isAccessible) {
      return;
    }
    if (!isRecording) {
      ipcRenderer.send("start-recording", "");
    } else {
      ipcRenderer.send("stop-recording", "");
    }
    setRecordingState(!isRecording);
  };

  const cleanRecorded = (rec: Record[]) => {
    log.info("Clean recorded", rec);
    const newRecorded = [];
    for (let i = 1; i < rec.length; i += 1) {
      const p = i - 1;
      log.info(`pressed key: ${rec[i].char}`, rec[p], rec[i]);
      if (rec[p].keycode > 223 && rec[p].keycode < 232) {
        log.info(`Modifier detected: ${rec[p].char}`);
        newRecorded.push(JSON.parse(JSON.stringify(rec[p])));
        continue;
      }
      if (rec[p].keycode === rec[i].keycode && rec[p].action === 6 && rec[i].action === 7) {
        log.info(
          `pressRelease joining ${rec[i].char} as 1 with ${rec[p].action} as p action and ${rec[i].action} as i action, being i:${i}, and p:${p}`,
        );
        newRecorded.push(JSON.parse(JSON.stringify(rec[p])));
        newRecorded[newRecorded.length - 1].action = 8;
        i += 1;
        log.info("state of i", i);
        if (i >= rec.length - 1) {
          newRecorded.push(rec[rec.length - 1]);
        }
        continue;
      }
      log.info(`Added as end of interaction ${rec[p].char} to the rest of the elems`);
      newRecorded.push(rec[p]);
      if (i === rec.length - 1) {
        newRecorded.push(rec[i]);
      }
    }
    if (
      newRecorded[newRecorded.length - 1].keycode === newRecorded[newRecorded.length - 2].keycode &&
      newRecorded[newRecorded.length - 2].action === 8 &&
      newRecorded[newRecorded.length - 1].action < 8
    )
      newRecorded.pop();
    log.info("Checking cleaned", newRecorded);
    return newRecorded;
  };

  const sendMacro = () => {
    if (isRecording) {
      ipcRenderer.send("stop-recording", "");
    }
    onAddRecorded(cleanRecorded(recording.current));
    recording.current = [];
    setIsRecording(false);
    toggleShow();
  };

  return (
    <div>
      <Button
        className="w-full rounded-regular !text-ssm !text-left !justify-start font-semibold py-[12px] pl-[8px] pr-[12px] bg-gray-25/25 hover:bg-gray-25/100 text-gray-500 hover:text-gray-600 dark:bg-gray-800/40 dark:hover:bg-gray-800/60 dark:text-gray-50 dark:hover:text-gray-25 transition-all relative flex gap-2 items-center mb-[2px] whitespace-nowrap [&_svg]:text-gray-300 [&:hover_svg]:text-primary/100 [&_svg]:transition-all"
        onClick={toggleShow}
        icon={<IconRecord />}
        iconDirection="left"
      >
        {i18n.editor.macros.recordMacro}
      </Button>
      <Dialog
        open={showModal}
        onOpenChange={toggleShow}
        // className="modal modal-recordMacro focus:outline-none focus-visible:outline-none focus:border-none focus-visible:border-none"
      >
        <DialogContent
          className="modal-recordMacro focus:outline-none focus-visible:outline-none focus:border-none focus-visible:border-none"
          onInteractOutside={e => {
            e.preventDefault();
          }}
          onEscapeKeyDown={e => {
            e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex justify-center text-center">
              {isRecording ? i18n.editor.macros.recordingMacro : i18n.editor.macros.recordMacro}
            </DialogTitle>
          </DialogHeader>
          <div className="px-0 pb-2 mt-2">
            <div className="recordMacroOptions flex items-center justify-center gap-2 mb-2">
              <Heading headingLevel={5} renderAs="h5">
                {i18n.editor.macros.delays}
              </Heading>
              <div className="recordMacroButtons flex items-center gap-2">
                <Button
                  variant="config"
                  size="sm"
                  onClick={setDelayOff}
                  disabled={isRecording}
                  selected={!isDelayActive.current}
                  className="flex gap-2"
                >
                  <IconStopwatchCrossed />
                  {i18n.editor.macros.ignoreDelays}
                </Button>
                <Button
                  variant="config"
                  size="sm"
                  onClick={setDelayOn}
                  disabled={isRecording}
                  selected={isDelayActive.current}
                  className="flex gap-2"
                >
                  <IconStopWatch />
                  {i18n.editor.macros.recordDelays}
                </Button>
              </div>
            </div>
            <div className="timelineRecordTracking">
              {recording.current.length === 0 ? (
                <div className="timelineRecordSequence">...</div>
              ) : (
                <div className={`timelineRecordSequence ${isRecording ? "isRecording" : "isPaused"}`}>
                  <div className="timelineRecordSequenceInner">{recorded}</div>
                  <div className="timelinePointeText" />
                </div>
              )}

              <AnimatedTimelineRecording isRecording={isRecording} />
            </div>
            <div className="recordMacrosButton flex justify-center gap-2 items-center -mt-6">
              {recording.current.length > 0 ? (
                <div className="ml-[-50px] relative z-10">
                  <TooltipProvider delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <Button variant="config" size="icon" onClick={undoRecording} className="!rounded-full">
                            <IconUndoRestart />
                          </Button>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs" size="sm">
                        {i18n.editor.macros.recordingDiscard}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ) : (
                ""
              )}

              <Button
                className={`border-solid border-[3px] border-primary/100 bg-gray-25/50 hover:bg-gray-25/100 dark:bg-gray-700/30 dark:hover:bg-gray-700/60 rounded-[32px] w-[204px] relative z-[3] recordButton backdrop-blur-sm font-bold !text-primary/100 ${isRecording ? "isRecording" : ""} ${
                  recording.current.length > 0 && !isRecording ? "isResume text-primary/100" : "text-primary/100"
                }`}
                onClick={toggleIsRecording}
                ref={buttonRecord}
              >
                {recording.current.length === 0 && !isRecording ? (
                  i18n.editor.macros.startRecord
                ) : isRecording ? (
                  <IconPause size="xl" />
                ) : (
                  "Resume"
                )}
              </Button>
            </div>
            <div className="tabSaveButton w-full flex justify-center mt-4 mb-4">
              <Button
                icon={<IconArrowInBoxDown />}
                iconDirection="right"
                variant="secondary"
                disabled={!!(recording.current.length === 0 || isRecording)}
                onClick={sendMacro}
              >
                {i18n.editor.macros.textTabs.buttonText}
              </Button>
            </div>
            <p className="recordingMessage">{i18n.editor.macros.recordingMessage}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RecordMacroModal;
