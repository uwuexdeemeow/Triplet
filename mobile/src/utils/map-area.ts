type Point = { latitude: number; longitude: number };

// Changes only when the points do, so a map isn't reframed on every render
export function areaKey(area: Point[]): string {
  return area.map((point) => `${point.latitude},${point.longitude}`).join(';');
}
