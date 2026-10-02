import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { Caveat_600SemiBold } from '@expo-google-fonts/caveat';
import { DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { PressStart2P_400Regular } from '@expo-google-fonts/press-start-2p';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Image } from 'expo-image';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { api, resolveApiUrl } from '@/api/client';
import { tripKeys, type Flight } from '@/api/trips';
import { Buddy } from '@/appearance/buddy';
import { DEFAULT_APPEARANCE, colourHex, hasBuddies, mix, type TripAppearance } from '@/appearance/looks';
import { sceneSky, sceneXml } from '@/appearance/pixel-art';
import { activityClock, activityDay, formatShortDate, tripPhase } from '@/utils/dates';
import { SvgImage } from '@/appearance/svg-image';

/** The fonts the styles use, loaded the first time a banner shows rather than holding up the app. */
export function useStyleFonts(): boolean {
  const [loaded] = useFonts({
    BebasNeue_400Regular,
    Caveat_600SemiBold,
    DMMono_500Medium,
    DMSerifDisplay_400Regular,
    PressStart2P_400Regular,
  });
  return loaded;
}

export type BannerTrip = {
  id: number;
  destination: string;
  destinations?: { name: string; latitude?: number | null; longitude?: number | null }[];
  start_date?: string | null;
  appearance?: TripAppearance;
  cover_url?: string | null;
};

type TripBannerProps = {
  trip: BannerTrip;
  // A look being tried out, instead of the saved one
  appearance?: TripAppearance;
  // Off where the person can't read the trip's flights, like a share link
  loadFlight?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/**
 * A trip drawn in its style: the 8-bit scene, poster, postcard and so on, in its colour and with
 * its buddy. It fills whatever size it's given, and `children` (like a Customize button) sit on top.
 */
export const TripBanner = memo(function TripBanner({ trip, appearance, loadFlight = true, style, children }: TripBannerProps) {
  const look = appearance ?? trip.appearance ?? DEFAULT_APPEARANCE;
  const [size, setSize] = useState({ width: 0, height: 0 });
  useStyleFonts();

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (Math.round(width) !== size.width || Math.round(height) !== size.height) {
      setSize({ width: Math.round(width), height: Math.round(height) });
    }
  };

  const accent = colourHex(look.colour);
  const background =
    look.style === 'pixel'
      ? sceneSky(look.scene, accent)
      : look.style === 'poster'
        ? mix(accent, '#FFFFFF', 0.8)
        : look.style === 'postcard'
          ? '#FBF6EC'
          : look.style === 'topo'
            ? mix(accent, '#FFFFFF', 0.9)
            : look.style === 'ticket' || (look.style === 'pattern' && look.pattern === 'emoji')
              ? mix(accent, '#FFFFFF', 0.86)
              : accent;

  return (
    <View
      onLayout={onLayout}
      style={[{ overflow: 'hidden', backgroundColor: background }, style]}
      // Decoration: the trip's name is always written next to it
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {size.width > 0 ? (
        <Art trip={trip} look={look} accent={accent} width={size.width} height={size.height} loadFlight={loadFlight} />
      ) : null}
      {children}
    </View>
  );
});

type ArtProps = { trip: BannerTrip; look: TripAppearance; accent: string; width: number; height: number; loadFlight: boolean };

function Art({ trip, look, accent, width, height, loadFlight }: ArtProps) {
  // Everything is laid out for a banner 170 points tall, and scaled from there
  const k = Math.min(1.6, Math.max(0.45, height / 170));
  const place = trip.destinations?.[0]?.name ?? trip.destination;
  const buddy = hasBuddies(look.style) ? look.buddies[look.style] : null;

  switch (look.style) {
    case 'pixel':
      return (
        <>
          <PixelScene look={look} accent={accent} width={width} height={height} />
          {buddy ? (
            <Buddy
              buddy={buddy}
              accent={accent}
              size={Math.round(58 * k)}
              style={{ position: 'absolute', left: 20 * k, bottom: 8 * k }}
            />
          ) : null}
        </>
      );
    case 'poster':
      return (
        <>
          <SvgImage xml={posterXml(accent, width, height)} width={width} height={height} style={fill} />
          <Text
            numberOfLines={1}
            style={{
              position: 'absolute',
              left: 18 * k,
              bottom: 10 * k,
              right: buddy ? 90 * k : 18 * k,
              fontFamily: 'BebasNeue_400Regular',
              fontSize: 48 * k,
              letterSpacing: 4 * k,
              color: '#FFFFFF',
            }}>
            {place.toUpperCase()}
          </Text>
          {/* A shade darker than the front hill it stands on */}
          {buddy ? (
            <Buddy
              buddy={buddy}
              accent={mix(accent, '#000000', 0.35)}
              size={Math.round(66 * k)}
              style={{ position: 'absolute', right: 18 * k, bottom: 8 * k }}
            />
          ) : null}
        </>
      );
    case 'postcard':
      return <Postcard place={place} start={trip.start_date} buddy={buddy} accent={accent} k={k} />;
    case 'stickers':
      return <Stickers place={place} start={trip.start_date} buddy={buddy} accent={accent} k={k} width={width} />;
    case 'pattern':
      return look.pattern === 'emoji' ? (
        <EmojiTiles emoji={look.emoji} width={width} height={height} k={k} />
      ) : (
        <SvgImage xml={patternXml(look.pattern, width, height)} width={width} height={height} style={fill} />
      );
    case 'topo':
      return <Topo trip={trip} place={place} accent={accent} width={width} height={height} k={k} />;
    case 'ticket':
      return <Ticket trip={trip} place={place} accent={accent} k={k} loadFlight={loadFlight} />;
    case 'photo':
      return <Photo url={trip.cover_url} accent={accent} k={k} />;
    case 'solid':
    default:
      return null;
  }
}

const fill = { position: 'absolute', left: 0, top: 0 } as const;

// ---------- 8-bit ----------

function PixelScene({ look, accent, width, height }: { look: TripAppearance; accent: string; width: number; height: number }) {
  // Chunky enough to read as pixel art, about 20 pixels from top to bottom
  const unit = Math.min(12, Math.max(4, Math.round(height / 20)));
  const columns = Math.ceil(width / unit);
  const rows = Math.ceil(height / unit);
  const xml = useMemo(() => sceneXml(look.scene, accent, columns, rows), [look.scene, accent, columns, rows]);
  return <SvgImage xml={xml} width={columns * unit} height={rows * unit} style={{ position: 'absolute', left: 0, bottom: 0 }} />;
}

// ---------- Travel poster ----------

function posterXml(accent: string, width: number, height: number): string {
  const ellipse = (cx: number, cy: number, rx: number, ry: number, colour: string) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${colour}"/>`;
  const sun = Math.min(height * 0.25, 42 * (height / 170));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <circle cx="${width * 0.66}" cy="${height * 0.36}" r="${sun}" fill="#F2B04A"/>
    ${ellipse(width * 0.27, height * 1.02, width * 0.39, height * 0.5, mix(accent, '#FFFFFF', 0.5))}
    ${ellipse(width * 0.76, height * 1.06, width * 0.42, height * 0.53, mix(accent, '#FFFFFF', 0.25))}
    ${ellipse(width * 0.6, height * 1.16, width * 0.48, height * 0.5, accent)}
  </svg>`;
}

// ---------- Postcard ----------

function Postcard({
  place,
  start,
  buddy,
  accent,
  k,
}: {
  place: string;
  start?: string | null;
  buddy: string | null;
  accent: string;
  k: number;
}) {
  const postmark = start ? formatShortDate(start).toUpperCase() : '';
  return (
    <>
      <View style={{ position: 'absolute', left: 18 * k, top: 14 * k, right: 100 * k }}>
        <Text style={{ fontFamily: 'Caveat_600SemiBold', fontSize: 24 * k, color: '#61666F' }}>Greetings from</Text>
        <Text
          numberOfLines={2}
          style={{ fontFamily: 'DMSerifDisplay_400Regular', fontSize: 42 * k, lineHeight: 44 * k, color: accent }}>
          {place}
        </Text>
      </View>
      {/* The stamp, with the buddy printed on it */}
      <View
        style={{
          position: 'absolute',
          right: 16 * k,
          top: 14 * k,
          width: 62 * k,
          height: 74 * k,
          padding: 4 * k,
          backgroundColor: '#FBF6EC',
          borderWidth: Math.max(2, 4 * k),
          borderColor: mix(accent, '#FFFFFF', 0.82),
          borderStyle: 'dotted',
        }}>
        <View
          style={{
            flex: 1,
            borderWidth: 1.5,
            borderColor: accent,
            backgroundColor: mix(accent, '#FFFFFF', 0.82),
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {buddy ? <Buddy buddy={buddy} accent={accent} size={Math.round(40 * k)} /> : null}
        </View>
      </View>
      {postmark ? (
        <View
          style={{
            position: 'absolute',
            right: 62 * k,
            top: 60 * k,
            width: 62 * k,
            height: 62 * k,
            borderRadius: 31 * k,
            borderWidth: 2,
            borderColor: 'rgba(22,24,29,0.35)',
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: '-14deg' }],
          }}>
          <Text style={{ fontFamily: 'DMMono_500Medium', fontSize: 9 * k, color: 'rgba(22,24,29,0.6)', textAlign: 'center' }}>
            {postmark}
          </Text>
        </View>
      ) : null}
    </>
  );
}

// ---------- Stickers ----------

const STICKER_ICONS: { x: number; y: number; r: number; icon: 'send' | 'camera' | 'coffee' | 'sun' }[] = [
  { x: 0.05, y: 0.12, r: -10, icon: 'send' },
  { x: 0.27, y: 0.52, r: 8, icon: 'camera' },
  { x: 0.5, y: 0.14, r: -4, icon: 'coffee' },
  { x: 0.07, y: 0.6, r: 6, icon: 'sun' },
];

function Stickers({
  place,
  start,
  buddy,
  accent,
  k,
  width,
}: {
  place: string;
  start?: string | null;
  buddy: string | null;
  accent: string;
  k: number;
  width: number;
}) {
  const year = start ? `’${start.slice(2, 4)}` : '';
  const tile = 46 * k;
  return (
    <>
      {STICKER_ICONS.map((sticker) => (
        <View
          key={sticker.icon}
          style={{
            position: 'absolute',
            left: sticker.x * width,
            top: `${sticker.y * 100}%`,
            width: tile,
            height: tile,
            borderRadius: 12 * k,
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: `${sticker.r}deg` }],
            boxShadow: '0 2px 0 rgba(0,0,0,0.18)',
          }}>
          <Feather name={sticker.icon} size={22 * k} color={accent} />
        </View>
      ))}
      <View
        style={{
          position: 'absolute',
          left: width * 0.38,
          top: '12%',
          paddingHorizontal: 12 * k,
          paddingVertical: 4 * k,
          borderRadius: 999,
          backgroundColor: '#F2C94C',
          transform: [{ rotate: '6deg' }],
          maxWidth: width * 0.58,
        }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: 'BebasNeue_400Regular', fontSize: 22 * k, letterSpacing: 2 * k, color: '#16181D' }}>
          {place.toUpperCase()} {year}
        </Text>
      </View>
      {buddy ? (
        <Buddy
          buddy={buddy}
          accent={accent}
          size={Math.round(76 * k)}
          style={{ position: 'absolute', right: width * 0.07, bottom: 10 * k, transform: [{ rotate: '-6deg' }] }}
        />
      ) : null}
    </>
  );
}

// ---------- Pattern ----------

const PATTERN_TILES: Record<string, { w: number; h: number; body: string; transform?: string }> = {
  dots: { w: 18, h: 18, body: '<circle cx="9" cy="9" r="2.4" fill="#FFFFFF" fill-opacity="0.3"/>' },
  waves: {
    w: 28,
    h: 14,
    body: '<path d="M3 14 A11 11 0 0 1 25 14" fill="none" stroke="#FFFFFF" stroke-opacity="0.24" stroke-width="2.4"/>',
  },
  grid: {
    w: 20,
    h: 20,
    body: '<path d="M0 0.5 H20 M0.5 0 V20" fill="none" stroke="#FFFFFF" stroke-opacity="0.2" stroke-width="1"/>',
  },
  stripes: { w: 18, h: 18, body: '<rect width="8" height="18" fill="#FFFFFF" fill-opacity="0.2"/>', transform: 'rotate(45)' },
  checks: {
    w: 24,
    h: 24,
    body: '<rect width="12" height="12" fill="#FFFFFF" fill-opacity="0.18"/><rect x="12" y="12" width="12" height="12" fill="#FFFFFF" fill-opacity="0.18"/>',
  },
  zigzag: {
    w: 22,
    h: 12,
    body: '<polyline points="0,11 11,1 22,11" fill="none" stroke="#FFFFFF" stroke-opacity="0.26" stroke-width="3"/>',
  },
};

export function patternXml(pattern: string, width: number, height: number): string {
  const tile = PATTERN_TILES[pattern] ?? PATTERN_TILES.dots;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <defs><pattern id="pattern-${pattern}" width="${tile.w}" height="${tile.h}" patternUnits="userSpaceOnUse"${tile.transform ? ` patternTransform="${tile.transform}"` : ''}>${tile.body}</pattern></defs>
    <rect width="${width}" height="${height}" fill="url(#pattern-${pattern})"/>
  </svg>`;
}

function EmojiTiles({ emoji, width, height, k }: { emoji: string; width: number; height: number; k: number }) {
  const size = Math.max(14, 24 * k);
  const step = size * 1.75;
  const columns = Math.ceil(width / step) + 1;
  const rows = Math.ceil(height / step) + 1;
  return (
    <View style={[fill, { width, height }]}>
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, column) => (
          <Text
            key={`${row}-${column}`}
            style={{
              position: 'absolute',
              left: column * step + (row % 2 ? step / 2 : 0) - step / 3,
              top: row * step - step / 4,
              fontSize: size,
              lineHeight: size * 1.2,
              transform: [{ rotate: `${(((row + column) % 3) - 1) * 14}deg` }],
            }}>
            {emoji}
          </Text>
        )),
      )}
    </View>
  );
}

// ---------- Topo lines ----------

function Topo({
  trip,
  place,
  accent,
  width,
  height,
  k,
}: {
  trip: BannerTrip;
  place: string;
  accent: string;
  width: number;
  height: number;
  k: number;
}) {
  const first = trip.destinations?.[0];
  const coords =
    first?.latitude != null && first.longitude != null
      ? `${Math.abs(first.latitude).toFixed(2)}° ${first.latitude >= 0 ? 'N' : 'S'} · ${Math.abs(first.longitude).toFixed(2)}° ${first.longitude >= 0 ? 'E' : 'W'}`
      : null;
  const rings = (cx: number, cy: number, gap: number) =>
    Array.from(
      { length: 14 },
      (_, index) => `<circle cx="${cx}" cy="${cy}" r="${(index + 1) * gap}" fill="none" stroke="${accent}" stroke-width="1.5"/>`,
    ).join('');
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><g opacity="0.3">${rings(width * 0.18, height * 0.75, 14.5 * k)}${rings(width * 0.82, height * 0.18, 18.5 * k)}</g></svg>`;
  return (
    <>
      <SvgImage xml={xml} width={width} height={height} style={fill} />
      <View style={{ position: 'absolute', left: 18 * k, bottom: 12 * k, right: 18 * k }}>
        {coords ? <Text style={{ fontFamily: 'DMMono_500Medium', fontSize: 11 * k, color: accent }}>{coords}</Text> : null}
        <Text
          numberOfLines={1}
          style={{ fontFamily: 'Geist_600SemiBold', fontSize: 28 * k, letterSpacing: -0.5 * k, color: '#16181D' }}>
          {place}
        </Text>
      </View>
    </>
  );
}

// ---------- Boarding pass ----------

const BARS = [3, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 3, 1, 2, 1, 3, 1, 2, 2, 1, 3, 1];

function Ticket({
  trip,
  place,
  accent,
  k,
  loadFlight,
}: {
  trip: BannerTrip;
  place: string;
  accent: string;
  k: number;
  loadFlight: boolean;
}) {
  // The same query as the trip's flights list, so it's shared with it
  const flights = useQuery({
    queryKey: tripKeys.flights(trip.id),
    queryFn: () => api<Flight[]>(`/trips/${trip.id}/flights`),
    enabled: loadFlight,
  });
  const flight = flights.data?.[0];
  const phase = trip.start_date ? tripPhase(trip.start_date, trip.start_date) : null;
  const mono = { fontFamily: 'DMMono_500Medium', color: '#61666F', fontSize: 9 * k, letterSpacing: 1.5 * k } as const;
  const code = { fontFamily: 'DMMono_500Medium', fontSize: 30 * k, color: '#16181D' } as const;

  return (
    <View
      style={{
        position: 'absolute',
        left: 12 * k,
        right: 12 * k,
        top: 12 * k,
        bottom: 12 * k,
        borderRadius: 12 * k,
        backgroundColor: '#FFFFFF',
        flexDirection: 'row',
        overflow: 'hidden',
      }}>
      <View style={{ flex: 1, paddingHorizontal: 14 * k, paddingVertical: 10 * k, gap: 5 * k, minWidth: 0 }}>
        <Text numberOfLines={1} style={mono}>
          BOARDING PASS{flight?.flight_number ? ` · ${flight.flight_number}` : ''}
        </Text>
        {flight?.from_code && flight.to_code ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 * k }}>
            <Text style={code}>{flight.from_code}</Text>
            <Feather name="send" size={20 * k} color={accent} />
            <Text style={code}>{flight.to_code}</Text>
          </View>
        ) : (
          <Text numberOfLines={1} style={[code, { fontSize: 24 * k }]}>
            {place.toUpperCase()}
          </Text>
        )}
        <Text numberOfLines={1} style={{ fontFamily: 'Geist_400Regular', fontSize: 12 * k, color: '#61666F' }}>
          {flight
            ? `${formatShortDate(activityDay(flight.departs_at))} · ${activityClock(flight.departs_at)}`
            : trip.start_date
              ? formatShortDate(trip.start_date)
              : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 2 * k, height: 18 * k, marginTop: 'auto', overflow: 'hidden' }}>
          {BARS.map((bar, index) => (
            <View key={index} style={{ width: bar * k, backgroundColor: '#16181D' }} />
          ))}
        </View>
      </View>
      <View
        style={{
          width: 80 * k,
          borderLeftWidth: 2,
          borderStyle: 'dashed',
          borderColor: '#E6E9ED',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2 * k,
        }}>
        {phase?.phase === 'upcoming' ? (
          <>
            <Text style={mono}>IN</Text>
            <Text style={{ fontFamily: 'DMMono_500Medium', fontSize: 28 * k, color: accent }}>{phase.daysToGo}</Text>
            <Text style={mono}>{phase.daysToGo === 1 ? 'DAY' : 'DAYS'}</Text>
          </>
        ) : (
          <Feather name="send" size={26 * k} color={accent} />
        )}
      </View>
    </View>
  );
}

// ---------- Your photo ----------

function Photo({ url, accent, k }: { url?: string | null; accent: string; k: number }) {
  const source = resolveApiUrl(url);
  if (!source) {
    return (
      <View style={[fill, { right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }]}>
        <Feather name="image" size={28 * k} color="rgba(255,255,255,0.7)" />
      </View>
    );
  }
  return (
    <>
      <Image
        source={source}
        style={[fill, { right: 0, bottom: 0 }]}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
      />
      {/* A wash of the trip colour, so every photo sits with the rest of the trip */}
      <View style={[fill, { right: 0, bottom: 0, backgroundColor: accent, opacity: 0.28 }]} />
    </>
  );
}
