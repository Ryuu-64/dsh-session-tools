import assert from 'node:assert/strict';
import path from 'node:path';
const A = 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const pause = page => page.waitForTimeout(350);
async function measure(reader, key) {
  return reader.locator('[data-reader-scroll]').first().evaluate((el, key) => {
    const top = el.getBoundingClientRect().top + el.clientTop;
    const rows = [...el.querySelectorAll('[data-reader-anchor]')];
    const row = key ? rows.find(row => row.dataset.readerAnchor === key) : rows.find(row => row.getBoundingClientRect().bottom > top);
    return { key: row?.dataset.readerAnchor, text: row?.textContent, offset: row ? row.getBoundingClientRect().top - top : null,
      scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atTail: el.scrollHeight - el.scrollTop - el.clientHeight < 3, chars: el.textContent.length };
  }, key);
}
function same(captured, current) {
  assert.equal(current.key, captured.key); assert.equal(current.text, captured.text);
  assert.ok(Math.abs(current.offset - captured.offset) < 2, JSON.stringify({captured,current}));
}
export async function exercisePoc(page, output, { control, uninstall }) {
  const search = page.getByRole('button', { name: 'Search sessions' });
  await search.waitFor({ timeout: 30000 }); await search.click();
  await page.getByRole('textbox', { name: /^(Search sessions\.\.\.|Search session names)$/ }).fill('RETURN_A_USER_1');
  await page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem').first().click();
  await page.getByText('RETURN_A_USER_80', { exact: false }).last().waitFor();
  await page.getByRole('tab', { name: 'Reading PoC', exact: true }).click();
  const reader = page.locator('[data-reader-instance]').first();
  await reader.getByText('RETURN_A_USER_80', { exact: false }).waitFor(); await pause(page);
  await reader.getByRole('button', {name: 'Go to latest', exact: true}).click();
  const captured = await measure(reader); assert.ok(captured.atTail);
  await page.screenshot({ path: path.join(output, '01-original-tail.png') });
  await reader.getByRole('combobox', {name:'Reading session 0'}).selectOption(B);
  await reader.getByText('RETURN_B_USER_80', { exact: false }).waitFor();
  await control({op:'stream',id:A,marker:'POC_STREAM_A'});
  await page.waitForTimeout(800);
  await control({op:'release',count:2}); await page.waitForTimeout(800);
  await reader.getByRole('button', {name:'Return to source',exact:true}).click();
  await reader.getByText('RETURN_A_USER_80', { exact:false }).waitFor();
  await reader.getByText('POC_STREAM_A_2', {exact:false}).waitFor(); await pause(page);
  const returned = await measure(reader,captured.key); same(captured,returned);
  assert.equal(await reader.getAttribute('data-reader-mode'),'holding'); assert.ok(!returned.atTail);
  assert.ok(returned.scrollHeight > captured.scrollHeight);
  await page.screenshot({path:path.join(output,'02-return-held-after-growth.png')});
  await control({op:'release',count:2});
  await reader.getByText('POC_STREAM_A_4',{exact:false}).waitFor(); await pause(page);
  const continued = await measure(reader,captured.key); same(captured,continued); assert.ok(continued.scrollHeight > returned.scrollHeight);
  await page.screenshot({path:path.join(output,'03-held-during-continuing-stream.png')});
  // Same session, two actual simultaneously mounted reader instances.
  await reader.getByRole('button',{name:'Open independent reader',exact:true}).click();
  const copy=page.locator('[data-reader-instance]').nth(1);
  await copy.getByText('POC_STREAM_A_4',{exact:false}).waitFor(); await pause(page);
  await copy.getByRole('button',{name:'Go to latest',exact:true}).click();
  assert.ok((await measure(copy)).atTail); same(captured,await measure(reader,captured.key));
  await control({op:'release',count:1}); await copy.getByText('POC_STREAM_A_5',{exact:false}).waitFor(); await pause(page);
  assert.ok((await measure(copy)).atTail); same(captured,await measure(reader,captured.key));
  await reader.getByRole('button',{name:'Close independent reader',exact:true}).click();
  await reader.getByRole('button',{name:'Go to latest',exact:true}).click();
  assert.ok((await measure(reader)).atTail);
  await control({op:'release',count:2}); await reader.getByText('POC_STREAM_A_7',{exact:false}).waitFor(); await pause(page);
  const latest=await measure(reader); assert.ok(latest.atTail);
  await page.screenshot({path:path.join(output,'04-explicit-latest-follow.png')});
  uninstall();
  await page.getByRole('tab',{name:'Reading PoC',exact:true}).waitFor({state:'hidden',timeout:30000});
  await page.locator('[data-chat-flow]').waitFor({timeout:30000});
  await page.getByText('POC_STREAM_A_7',{exact:false}).last().waitFor();
  assert.equal(await page.locator('[data-reader-instance]').count(),0);
  await page.screenshot({path:path.join(output,'05-uninstalled-native-chat-restored.png')});
  return { captured, returned, continued, latest, instanceIsolation:'passed', unloadNativeRestored:'passed', scope:'internal reader A/B navigation only; native session navigation remount restoration not implemented' };
}
