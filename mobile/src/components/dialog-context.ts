import { createContext, use } from 'react';

// Set by FormScreen when it draws a dialog (the website on a bigger screen), so what's inside, like
// buttons and form sections, can lay itself out for a desktop instead of a phone
export const DialogContext = createContext(false);

export function useInDialog(): boolean {
  return use(DialogContext);
}
