// Links that open the app before Expo Router picks a screen.
//
// The iOS share extension opens Triplet with triplet://dataUrl=tripletShareKey. That isn't a
// page, so send it to the "Save to a trip" screen, which reads what was shared.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes('dataUrl=')) return '/share';
  return path;
}
