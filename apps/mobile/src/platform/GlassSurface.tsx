/**
 * Default (Android + web) resolution of the glass wrapper → blur fallback.
 *
 * Metro picks `GlassSurface.ios.tsx` on iOS, so `expo-glass-effect` is only ever pulled
 * into the iOS bundle. Importing it from a runtime `Platform.OS` branch instead would
 * put the iOS-only module into the web bundle, which is what APP-RUN §0.2 rule 8 and
 * oracle S3.7 exist to prevent.
 */

export { BlurSurface as GlassSurface, hasRealGlass } from './shared/BlurSurface';
export type { BlurSurfaceProps as GlassSurfaceProps } from './shared/BlurSurface';
