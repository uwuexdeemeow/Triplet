import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

export type SvgImageProps = {
  // A whole SVG document, made by the app (never typed or uploaded by anyone)
  xml: string;
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
};

/** An SVG document drawn at a size. The website has its own version (svg-image.web.tsx). */
export function SvgImage({ xml, width, height, style }: SvgImageProps) {
  return (
    <View style={[{ width, height }, style]}>
      <SvgXml xml={xml} width={width} height={height} />
    </View>
  );
}
