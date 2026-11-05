// Brand tokens for this recipe (a copy of examples/brand.ts). Swap the brand with instantiate_recipe({ brand }).
// The accent is a live control ("Accent Color").
import { brand } from 'ae-compose';

export const BRAND = brand({
  colors: { ink: '#0b0d12', white: '#eef1f6', muted: '#8b95a5', accent: '#4683c4' },
  fonts: { display: 'Inter-Black', bold: 'Inter-Bold', body: 'Inter-Medium' },
  sizes: { hero: 190, headline: 120, sub: 52, body: 44 },
  live: ['accent'],
});
