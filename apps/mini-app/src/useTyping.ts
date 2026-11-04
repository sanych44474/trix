// True while a text field has focus, i.e. the on-screen keyboard is (or is about to be) up.
// Shared by every screen that shows a fixed bottom action (SaveDock, Today's MainButton).
import { useEffect, useState } from "react";
import { isTextEntry } from "./logic/typing";

export function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onIn = (e: FocusEvent) => { if (isTextEntry(e.target as HTMLElement | null)) setTyping(true); };
    const onOut = () => setTimeout(() => setTyping(isTextEntry(document.activeElement as HTMLElement | null)), 0);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => { document.removeEventListener("focusin", onIn); document.removeEventListener("focusout", onOut); };
  }, []);
  return typing;
}
