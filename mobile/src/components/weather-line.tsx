import { Feather } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import type { DayWeather } from '@/api/trips';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

/** A day's forecast, e.g. "Rain · 23° / 18° · 80% chance of rain". */
export function WeatherLine({ weather }: { weather: DayWeather }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const wet = /rain|drizzle|thunder|snow/i.test(weather.summary) || (weather.rain_chance ?? 0) >= 50;
  const parts = [
    weather.summary,
    weather.high != null && weather.low != null ? `${Math.round(weather.high)}° / ${Math.round(weather.low)}°` : null,
    weather.rain_chance != null && weather.rain_chance >= 20 ? `${weather.rain_chance}% chance of rain` : null,
  ].filter(Boolean);

  return (
    <View style={styles.weather} accessible accessibilityLabel={`Forecast: ${parts.join(', ')}`}>
      <Feather name={wet ? 'cloud-rain' : weather.summary === 'Clear' ? 'sun' : 'cloud'} size={15} color={colors.muted} />
      <Text style={styles.weatherText}>{parts.join(' · ')}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  weather: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -spacing.xs,
  },
  weatherText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
  },
}));
