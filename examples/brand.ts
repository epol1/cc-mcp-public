// The showcases' shared brand: colors, fonts and type sizes in one place. The accent is a live control
// ("Accent Color") in every scene that uses it.
import { brand } from 'ae-compose';

export const BRAND = brand({
  colors: { ink: '#0b0d12', white: '#eef1f6', muted: '#8b95a5', accent: '#4683c4' },
  fonts: { display: 'Inter-Black', bold: 'Inter-Bold', body: 'Inter-Medium' },
  sizes: { hero: 190, headline: 120, sub: 52, body: 44 },
  live: ['accent'],
});
