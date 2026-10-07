import { describe, expect, it } from 'vitest';
import { siteTitle } from '../../src/lib/format';

describe('siteTitle', () => {
  it('makes USGS gauge names readable', () => {
    expect(siteTitle('TENNESSEE RIVER AT GUNTERSVILLE, AL')).toBe('Tennessee River at Guntersville, AL');
    expect(siteTitle('LAKE FORK CREEK NR QUITMAN, TX')).toBe('Lake Fork Creek nr Quitman, TX');
    expect(siteTitle('TEST LAKE AT DAM')).toBe('Test Lake at Dam');
    expect(siteTitle('AT THE LAKE')).toBe('At the Lake');
  });
});
