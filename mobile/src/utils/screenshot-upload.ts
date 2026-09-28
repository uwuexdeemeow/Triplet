import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { api } from '@/api/client';
import type { SavedLink } from '@/api/trips';

// Wide enough to read small print on a screenshot, small enough for the server's 900 KB limit
const MAX_WIDTH = 1400;

/**
 * Let the user pick a screenshot (a post, a map, a list a friend sent) and save it to the trip,
 * where its places are read like a photo post. Returns null if they cancelled.
 */
export async function pickAndUploadScreenshot(tripId: number): Promise<SavedLink | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;

  let context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > MAX_WIDTH) context = context.resize({ width: MAX_WIDTH, height: null });
  const rendered = await context.renderAsync();
  const image = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });

  const form = new FormData();
  if (Platform.OS === 'web') {
    form.append('file', await (await fetch(image.uri)).blob(), 'screenshot.jpg');
  } else {
    form.append('file', { uri: image.uri, name: 'screenshot.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  return api<SavedLink>(`/trips/${tripId}/links/screenshot`, { method: 'POST', body: form });
}
