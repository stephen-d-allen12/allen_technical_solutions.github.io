/** USGS site names are all caps ("TENNESSEE RIVER AT GUNTERSVILLE, AL"); make them readable. */
export function siteTitle(name: string): string {
  const small = new Set(['at', 'near', 'nr', 'below', 'blw', 'above', 'abv', 'of', 'the', 'and', 'in', 'on']);
  const words = name.trim().toLowerCase().split(/\s+/);
  return words
    .map((w, i) => {
      const bare = w.replace(/[^a-z]/g, '');
      // A two-letter state code at the end, after a comma: "..., AL".
      if (i === words.length - 1 && bare.length === 2 && words[i - 1]?.endsWith(',')) return w.toUpperCase();
      if (i > 0 && small.has(bare)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}
