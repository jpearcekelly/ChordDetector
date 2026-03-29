export type MIDICallbacks = {
  noteOn: (note: number, velocity: number) => void;
  noteOff: (note: number) => void;
  allNotesOff: () => void;
  sustainOn: () => void;
  sustainOff: () => void;
};

export type MIDIStatus =
  | { state: "unsupported" }
  | { state: "pending" }
  | { state: "connected"; deviceCount: number }
  | { state: "denied" };

export async function initMIDI(
  callbacks: MIDICallbacks,
  onStatusChange: (status: MIDIStatus) => void,
): Promise<void> {
  if (!navigator.requestMIDIAccess) {
    onStatusChange({ state: "unsupported" });
    return;
  }

  onStatusChange({ state: "pending" });

  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    onStatusChange({ state: "denied" });
    return;
  }

  function connectInputs() {
    let count = 0;
    for (const input of access.inputs.values()) {
      input.onmidimessage = (event) => handleMessage(event, callbacks);
      count++;
    }
    onStatusChange({ state: "connected", deviceCount: count });
  }

  access.onstatechange = () => connectInputs();
  connectInputs();
}

function handleMessage(event: MIDIMessageEvent, callbacks: MIDICallbacks) {
  const data = event.data;
  if (!data || data.length < 1) return;

  const status = data[0] & 0xf0;

  switch (status) {
    case 0x90: // Note On
      if (data.length >= 3 && data[2] > 0) {
        callbacks.noteOn(data[1], data[2]);
      } else if (data.length >= 2) {
        // Note On with velocity 0 = Note Off
        callbacks.noteOff(data[1]);
      }
      break;
    case 0x80: // Note Off
      if (data.length >= 2) {
        callbacks.noteOff(data[1]);
      }
      break;
    case 0xb0: // Control Change
      if (data.length >= 3) {
        if (data[1] === 64) {
          // CC 64 = Sustain pedal: >= 64 means down, < 64 means up
          if (data[2] >= 64) {
            callbacks.sustainOn();
          } else {
            callbacks.sustainOff();
          }
        } else if (data[1] === 123) {
          callbacks.allNotesOff();
        }
      }
      break;
  }
}
