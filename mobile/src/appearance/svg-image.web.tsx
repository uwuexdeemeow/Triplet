import { View } from 'react-native';

import type { SvgImageProps } from '@/appearance/svg-image';

/**
 * On the website the browser draws the SVG itself. SvgXml would turn every shape into a component,
 * and a pixel scene has hundreds of them.
 */
export function SvgImage({ xml, width, height, style }: SvgImageProps) {
  return (
    <View style={[{ width, height }, style]}>
      {/* Only ever the app's own drawings, so it's safe to put in the page as it is */}
      <div
        style={{ width: '100%', height: '100%', lineHeight: 0 }}
        dangerouslySetInnerHTML={{ __html: xml.replace('<svg ', '<svg width="100%" height="100%" ') }}
      />
    </View>
  );
}
