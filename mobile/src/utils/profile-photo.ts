import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { api } from '@/api/client';
import type { User } from '@/api/trips';

const SIZE = 512;

/**
 * Let the user pick a square photo, shrink it to 512px and upload it as their profile photo.
 * Returns the updated user, or null if they cancelled.
 */
export async function pickAndUploadProfilePhoto(): Promise<User | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (picked.canceled || !picked.assets[0]) return null;

  // Phone photos are several MB; the server takes 2 MB at most, and a small circle needs far less
  const rendered = await ImageManipulator.manipulate(picked.assets[0].uri).resize({ width: SIZE, height: null }).renderAsync();
  const photo = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });

  const form = new FormData();
  if (Platform.OS === 'web') {
    // The browser needs the file's bytes; phones stream them from the uri
    form.append('file', await (await fetch(photo.uri)).blob(), 'photo.jpg');
  } else {
    form.append('file', { uri: photo.uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  }

  return api<User>('/users/me/avatar', { method: 'PUT', body: form });
}
