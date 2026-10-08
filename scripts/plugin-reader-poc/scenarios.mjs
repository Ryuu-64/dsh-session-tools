import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
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
  const checkpoints = {};
  const record = (name, value) => { checkpoints[name] = value; fs.writeFileSync(path.join(output, 'checkpoints.json'), JSON.stringify(checkpoints, null, 2)); };
  async function openSession(label) {
    const search = page.getByRole('button', { name: 'Search sessions' });
    await search.waitFor({ timeout: 30000 });
    if (await search.getAttribute('aria-expanded') !== 'true') await search.click();
    await page.getByRole('textbox', { name: /^(Search sessions\.\.\.|Search session names)$/ }).fill(`RETURN_${label}_USER_1`);
    await page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem').first().click();
    await page.getByText(`RETURN_${label}_USER_80`, { exact: false }).last().waitFor();
  }
  await openSession('A');
  // The original plugin card keeps its normal native navigation semantics.
  const nativeCard = page.locator(`[data-conversation-session="${A}"]`).getByRole('button', { name: 'RETURN_B', exact: true }).last();
  await nativeCard.scrollIntoViewIfNeeded(); await nativeCard.click();
  await page.locator(`[data-conversation-session="${B}"]`).waitFor();
  assert.equal(await page.locator('[data-reader-return]').count(), 0);
  assert.equal(await page.locator('[data-reader-instance]').count(), 0);
  record('ordinaryNativeCard', 'unchanged native navigation; no reader return');
  await openSession('A');
  await page.getByRole('tab', { name: 'Reading PoC', exact: true }).click();
  const reader = page.locator('[data-reader-instance]').first();
  await reader.getByText('RETURN_A_USER_80', { exact: false }).waitFor(); await pause(page);
  await reader.getByRole('button', {name: 'Go to latest', exact: true}).click();
  const captured = await measure(reader); record('captured', captured); assert.ok(captured.atTail);
  await page.screenshot({ path: path.join(output, '01-original-tail.png') });
  await reader.getByRole('combobox', {name:'Reading session 0'}).selectOption(B);
  await reader.getByText('RETURN_B_USER_80', { exact: false }).waitFor();
  await control({op:'stream',id:A,marker:'POC_STREAM_A'});
  await page.waitForTimeout(800);
  await control({op:'release',count:2}); await page.waitForTimeout(800);
  await reader.getByRole('button', {name:'Return to source',exact:true}).click();
  await reader.getByText('RETURN_A_USER_80', { exact:false }).waitFor();
  await reader.getByText('POC_STREAM_A_2', {exact:false}).waitFor(); await pause(page);
  const returned = await measure(reader,captured.key); record('returned', returned); same(captured,returned);
  assert.equal(await reader.getAttribute('data-reader-mode'),'holding'); assert.ok(!returned.atTail);
  assert.ok(returned.scrollHeight > captured.scrollHeight);
  await page.screenshot({path:path.join(output,'02-return-held-after-growth.png')});
  await control({op:'release',count:2});
  await reader.getByText('POC_STREAM_A_4',{exact:false}).waitFor(); await pause(page);
  const continued = await measure(reader,captured.key); record('continued', continued); same(captured,continued); assert.ok(continued.scrollHeight > returned.scrollHeight);
  await page.screenshot({path:path.join(output,'03-held-during-continuing-stream.png')});
  // Same session, two actual simultaneously mounted reader instances.
  await reader.getByRole('button',{name:'Open independent reader',exact:true}).click();
  const copy=page.locator('[data-reader-instance]').nth(1);
  await copy.getByText('POC_STREAM_A_4',{exact:false}).waitFor(); await pause(page);
  await copy.getByRole('button',{name:'Go to latest',exact:true}).click();
  assert.ok((await measure(copy)).atTail); same(captured,await measure(reader,captured.key));
  await control({op:'release',count:1}); await copy.getByText('POC_STREAM_A_5',{exact:false}).waitFor(); await pause(page);
  assert.ok((await measure(copy)).atTail); same(captured,await measure(reader,captured.key));
  record('instanceIsolation', { source: await measure(reader,captured.key), independent: await measure(copy) });
  await page.screenshot({path:path.join(output,'independent-readers.png')});
  await reader.getByRole('button',{name:'Close independent reader',exact:true}).click();
  await reader.getByRole('button',{name:'Go to latest',exact:true}).click();
  assert.ok((await measure(reader)).atTail);
  await control({op:'release',count:2}); await reader.getByText('POC_STREAM_A_7',{exact:false}).waitFor(); await pause(page);
  const latest=await measure(reader); record('latest', latest); assert.ok(latest.atTail);
  await page.screenshot({path:path.join(output,'04-explicit-latest-follow.png')});
  // Actual shared session-tools card, actual UIWorkspace navigation, and a
  // newly mounted source Reader. This is deliberately separate from internal A/B.
  const sourceMount = await reader.getAttribute('data-reader-instance');
  const actualCard = reader.locator('[data-reader-tool]').getByRole('button', { name: 'RETURN_B', exact: true }).last();
  await actualCard.scrollIntoViewIfNeeded(); await actualCard.focus();
  const cardCaptured = await measure(reader);
  await reader.evaluate(element => { window.__sourceReaderElement = element; });
  await actualCard.click();
  await page.locator(`[data-conversation-session="${B}"]`).waitFor();
  await page.getByText('RETURN_B_USER_80', { exact: false }).last().waitFor();
  assert.equal(await page.locator('[data-reader-instance]').count(), 0, 'source reader must leave the DOM during native navigation');
  const nativeBack = page.getByRole('button', { name: '返回 RETURN_A 的原位置', exact: true });
  await nativeBack.waitFor();
  await control({op:'stream',id:A,marker:'CARD_STREAM_A'}); await page.waitForTimeout(800);
  await control({op:'release',count:2}); await page.waitForTimeout(800);
  await page.screenshot({path:path.join(output,'card-target-native-B.png')});
  await nativeBack.click();
  await page.locator(`[data-conversation-session="${A}"]`).waitFor();
  await reader.getByText('CARD_STREAM_A_2',{exact:false}).waitFor(); await pause(page);
  const restoredMount = await reader.getAttribute('data-reader-instance');
  assert.notEqual(restoredMount, sourceMount, 'source reader must be a new component occurrence');
  assert.ok(await reader.evaluate(element => element !== window.__sourceReaderElement), 'source reader DOM must be remounted');
  const cardReturned = await measure(reader,cardCaptured.key); same(cardCaptured,cardReturned);
  assert.equal(await reader.getAttribute('data-reader-mode'),'holding');
  await nativeBack.waitFor({state:'hidden'});
  await control({op:'release',count:2}); await reader.getByText('CARD_STREAM_A_4',{exact:false}).waitFor(); await pause(page);
  const cardContinued = await measure(reader,cardCaptured.key); same(cardCaptured,cardContinued);
  assert.ok(cardContinued.scrollHeight > cardReturned.scrollHeight);
  record('nativeCardRemount', { sourceMount, restoredMount, captured: cardCaptured, returned: cardReturned, continued: cardContinued });
  await page.screenshot({path:path.join(output,'card-source-remounted-held.png')});
  await reader.getByRole('button',{name:'Go to latest',exact:true}).click();
  await control({op:'release',count:3}); await reader.getByText('CARD_STREAM_A_7',{exact:false}).waitFor(); await pause(page);
  assert.ok((await measure(reader)).atTail);
  // Explicit cancellation and unrelated native navigation must invalidate the
  // pending return, so it cannot later pull the user back to an older source.
  for (const interruption of ['cancel', 'other-navigation']) {
    const cardAgain = reader.locator('[data-reader-tool]').getByRole('button', {name:'RETURN_B',exact:true}).last();
    await cardAgain.scrollIntoViewIfNeeded(); await cardAgain.click();
    await page.locator(`[data-conversation-session="${B}"]`).waitFor();
    await page.getByRole('button',{name:'返回 RETURN_A 的原位置',exact:true}).waitFor();
    if (interruption === 'cancel') {
      await page.getByRole('button',{name:'取消返回',exact:true}).click();
      await page.locator('[data-reader-return]').waitFor({state:'hidden'});
      assert.equal(await page.locator('[data-reader-return]').count(),0, 'cancel alone must discard the return point');
      await page.locator(`[data-slot="main"] [data-conversation-session="${B}"]`).waitFor();
      assert.equal(await page.locator(`[data-slot="main"] [data-conversation-session="${A}"]`).count(),0, 'cancel must not navigate away from B');
    }
    await openSession('A');
    await reader.getByText('CARD_STREAM_A_7',{exact:false}).waitFor(); await pause(page);
    assert.equal(await page.locator('[data-reader-return]').count(),0, interruption + ' must discard the old return point');
    record(interruption, 'pending return invalidated; user-selected A remains active');
  }
  // Full Markdown blocks: a fence spans chunks/blank lines, then a table and
  // reference links. Resolving the links on settlement shrinks content ABOVE
  // the held line, so preserving scrollTop alone cannot pass this assertion.
  await reader.getByRole('button',{name:'Go to latest',exact:true}).click();
  await control({op:'stream',id:A,marker:'MARKDOWN_STREAM',markdown:true});
  await reader.getByRole('heading',{name:'MD_HEADING',exact:true}).waitFor();
  await control({op:'release',count:3});
  await reader.getByRole('heading',{name:'MD_STREAM_HEADING',exact:true}).waitFor();
  const markdown = reader.locator('[data-reader-markdown]').filter({has: page.getByRole('heading',{name:'MD_HEADING',exact:true})});
  assert.equal(await markdown.locator('pre code').count(),1, 'one intact fenced code block');
  assert.match(await markdown.locator('pre code').innerText(),/const first = 1;[\s\S]*const third = 3;/);
  assert.equal(await markdown.getByRole('columnheader').count(),2);
  assert.equal(await markdown.getByRole('listitem').count(),2);
  const heldLine = reader.getByText('MD_HOLD_ANCHOR unique stable reading line.',{exact:true});
  await heldLine.scrollIntoViewIfNeeded();
  const linePosition = () => heldLine.evaluate(node => {
    const scroll = node.closest('[data-reader-scroll]');
    return { text:node.textContent, top:node.getBoundingClientRect().top-scroll.getBoundingClientRect().top-scroll.clientTop, scrollTop:scroll.scrollTop };
  });
  const initialLine = await linePosition();
  await reader.locator('[data-reader-scroll]').first().hover();
  await page.mouse.wheel(0, initialLine.top - 12); await pause(page);
  const markdownCaptured = await linePosition();
  const referenceParagraph = markdown.locator('p').filter({hasText:'MD_REF'}).first();
  const prefixBefore = await referenceParagraph.evaluate(node=>node.getBoundingClientRect().height);
  await reader.getByRole('combobox',{name:'Reading session 0'}).selectOption(B);
  await reader.getByText('RETURN_B_USER_80',{exact:false}).waitFor();
  await control({op:'release',count:1});
  await reader.getByRole('button',{name:'Return to source',exact:true}).click();
  await heldLine.waitFor(); await pause(page);
  const markdownReturned = await linePosition();
  assert.ok(Math.abs(markdownReturned.top-markdownCaptured.top)<2, 'Markdown text position restores while still streaming');
  await page.screenshot({path:path.join(output,'markdown-held-streaming.png')});
  await control({op:'release',count:3});
  await markdown.getByRole('link',{name:'MD_REF',exact:true}).first().waitFor(); await pause(page);
  const prefixAfter = await referenceParagraph.evaluate(node=>node.getBoundingClientRect().height);
  const markdownSettled = await linePosition();
  assert.ok(prefixAfter < prefixBefore, 'reference-link finalization must cause real upstream reflow');
  assert.equal(markdownSettled.text,markdownCaptured.text);
  assert.ok(Math.abs(markdownSettled.top-markdownCaptured.top)<2, JSON.stringify({markdownCaptured,markdownSettled}));
  assert.notEqual(markdownSettled.scrollTop,markdownReturned.scrollTop, 'hold must correct for reflow, not merely freeze scrollTop');
  record('markdownReflow',{captured:markdownCaptured,returned:markdownReturned,settled:markdownSettled,prefixBefore,prefixAfter});
  await page.screenshot({path:path.join(output,'markdown-held-after-reflow.png')});
  await reader.getByRole('button',{name:'Go to latest',exact:true}).click(); assert.ok((await measure(reader)).atTail);
  uninstall();
  await page.getByRole('tab',{name:'Reading PoC',exact:true}).waitFor({state:'hidden',timeout:30000});
  await page.locator(`[data-conversation-session="${A}"] [data-chat-flow]`).first().waitFor({timeout:30000});
  await page.getByText('CARD_STREAM_A_7',{exact:false}).last().waitFor();
  assert.equal(await page.locator('[data-reader-instance]').count(),0);
  record('uninstalled', { pluginReaderCount: await page.locator('[data-reader-instance]').count(), nativeChat: true });
  await page.screenshot({path:path.join(output,'05-uninstalled-native-chat-restored.png')});
  return { captured, returned, continued, latest, instanceIsolation:'passed', unloadNativeRestored:'passed', nativeCardRemount: checkpoints.nativeCardRemount, markdownReflow: checkpoints.markdownReflow, scope:'optional reading mode source to native target and remounted reader return; ordinary native Chat source remains unchanged' };
}
