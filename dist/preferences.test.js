import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preferredAddress, loadPrefs, savePrefs } from './preferences.js';
test('pincode chooses only a unique saved address; persisted choice wins after reordering', () => {
    const home = { id: '1', label: 'Home', addressLine1: 'B - 013 Residency Park, HSR Layout', pincode: '560102' };
    const work = { id: '2', label: 'Work', addressLine1: 'Office, HSR Layout', pincode: '560102' };
    assert.equal(preferredAddress([home], '560102'), home);
    assert.equal(preferredAddress([home, work], '560102'), undefined);
    assert.equal(preferredAddress([work, home], '560102', home), home);
    assert.equal(preferredAddress([work], '560102', home), undefined);
    assert.equal(preferredAddress([home], '110001', home), undefined);
    assert.equal(preferredAddress([home]), undefined);
});
test('address preferences survive a restart and remain separate per platform', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-prefs-'));
    const file = join(dir, 'prefs.json');
    try {
        const home = { label: 'Home', addressLine1: 'Residency Park', pincode: '560102' };
        savePrefs({ pincode: '560102', selected_addresses: { bigbasket: home } }, file);
        savePrefs({ selected_addresses: { ...loadPrefs(file).selected_addresses, blinkit: { ...home, label: 'Bangalore' } } }, file);
        assert.deepEqual(loadPrefs(file).selected_addresses?.bigbasket, home);
        assert.equal(loadPrefs(file).selected_addresses?.blinkit.label, 'Bangalore');
        savePrefs({ pincode: '' }, file);
        assert.equal(loadPrefs(file).pincode, undefined);
        assert.deepEqual(loadPrefs(file).selected_addresses?.bigbasket, home);
    }
    finally {
        rmSync(dir, { recursive: true });
    }
});
//# sourceMappingURL=preferences.test.js.map