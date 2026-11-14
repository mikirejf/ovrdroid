import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { rebaseAll } from '../rebase.ts';
import { stackedViewPatches } from '../stacked-view-patches.ts';
import { payloadFunction, rebasedNamed } from './payload.ts';
import { stock } from './session-mention-harness.ts';

interface General {
  toolResultDisplay?: string;
  toolOutputDisplay?: string;
}

interface Settings {
  settings: { general: General };
  resolveToolOutputDisplay: (enabled: boolean) => string;
  getToolOutputDisplay: () => string;
  setToolOutputDisplay: (value: string) => void;
  displayRowAction: () => () => void;
  displayWrites: string[];
  displayedGeneral: General;
}

function matched(text: string, pattern: RegExp): RegExpExecArray {
  const match = pattern.exec(text);
  if (match === null) {
    throw new Error(`stock settings no longer match ${pattern.source}`);
  }
  return match;
}

function binding(match: RegExpExecArray, key: string): string {
  const name = match.groups?.[key];
  if (name === undefined) {
    throw new Error(`missing stock settings binding ${key}`);
  }
  return name;
}

function settingsFactory(): (enabled: boolean) => Settings {
  if (stock === undefined) {
    throw new Error('no stock Droid to patch');
  }
  const patches = stackedViewPatches.filter((patch) =>
    patch.name.startsWith('stacked-view-setting-'),
  );
  const rebases = rebaseAll(
    patches,
    stock.map((module) => module.text),
  );
  const modules = patchSource(stock, patches);
  const map = rebasedNamed(rebases, 'stacked-view-setting-legacy-map');
  const source = modules.find((module) => module.text.includes(map.replace))?.text;
  if (source === undefined) {
    throw new Error('no patched stock settings module');
  }
  const start = source.indexOf(map.replace);
  const helpers = source.slice(start, source.indexOf('class ', start));
  const [resolver] = matched(
    source,
    /resolveToolOutputDisplay\([\w$]+\)\{.*?\}(?=getToolOutputDisplayManagementInfo)/su,
  );
  const [setter] = matched(
    source,
    /setToolOutputDisplay\([\w$]+\)\{.*?\}(?=recordToolOutputDisplayState)/su,
  );
  const rowSource = modules.find((module) =>
    module.text.includes('id:"tool-result-display-setting",label:'),
  )?.text;
  if (rowSource === undefined) {
    throw new Error('no stock Preferences display row');
  }
  const row = matched(
    rowSource,
    /id:"tool-result-display-setting",label:.*?value:[\w$]+\((?<service>[\w$]+)\(\)\.getToolOutputDisplay\(\),[\w$]+\),action:(?<action>.*?),\.\.\./u,
  );
  const actionRoles = matched(
    binding(row, 'action'),
    /let [\w$]+=[^,;]+,[\w$]+=(?<cycle>[\w$]+)\([^;]+,(?<flag>[\w$]+)\);/u,
  );
  const cycleName = binding(actionRoles, 'cycle');
  const [cycle] = matched(
    rowSource,
    new RegExp(`function ${cycleName.replaceAll('$', '\\$')}\\([^)]*\\)\\{.*?\\}`, 'u'),
  );
  const refresh = binding(
    matched(binding(row, 'action'), /;(?<refresh>[\w$]+)\([\w$]+\?\{toolOutputDisplay:/u),
    'refresh',
  );
  const flag = matched(setter, /if\(!(?<read>[\w$]+)\((?<flags>[\w$]+)\.TuiConciseToolOutput\)\)/u);
  const names = [
    binding(matched(helpers, /Object.values\((?<enum>[\w$]+)\)/u), 'enum'),
    binding(flag, 'read'),
    binding(flag, 'flags'),
    binding(matched(resolver, /\?\?(?<default>[\w$]+)\)/u), 'default'),
    binding(matched(setter, /;(?<telemetry>[\w$]+)\.addToCounter/u), 'telemetry'),
    binding(matched(setter, /identifier:(?<key>[\w$]+),/u), 'key'),
  ];
  const enumPatch = rebasedNamed(rebases, 'stacked-view-setting-output-value');
  const enumSource = modules.find((module) => module.text.includes(enumPatch.replace))?.text;
  if (enumSource === undefined) {
    throw new Error('no patched stock display enum');
  }
  const at = enumSource.indexOf(enumPatch.replace);
  const declaration = enumSource.slice(
    enumSource.lastIndexOf('var ', at),
    enumSource.indexOf('||={});', at) + '||={});'.length,
  );
  const enumName = binding(matched(declaration, /^var (?<enum>[\w$]+);/u), 'enum');
  const values = payloadFunction<[], Record<string, string>>(
    [],
    `${declaration}return ${enumName}`,
  )();
  const create = payloadFunction<
    [Record<string, string>, () => boolean, object, string, object, string],
    Settings
  >(
    names,
    `${helpers}return new class{
      settings={general:{}};
      displayWrites=[];
      displayedGeneral={};
      getToolOutputDisplay(){return this.resolveToolOutputDisplay(${binding(flag, 'read')}())}
      displayRowAction(){
        ${cycle}
        let ${binding(row, 'service')}=()=>this,${binding(actionRoles, 'flag')}=${binding(flag, 'read')}(),
          ${refresh}=(value)=>{this.displayedGeneral=value};
        return (${binding(row, 'action')});
      }
      getToolOutputDisplayWinningEntry(){return{settings:this.settings}}
      updateUserGeneralSettings(value){
        this.displayWrites.push(value.toolOutputDisplay??value.toolResultDisplay);
        Object.assign(this.settings.general,value)
      }
      ${resolver}
      ${setter}
    }`,
  );
  return (enabled) =>
    create(
      values,
      () => enabled,
      { TuiConciseToolOutput: 'concise' },
      'expanded',
      { addToCounter() {} },
      'toolOutputDisplay',
    );
}

describe.skipIf(stock === undefined)('stacked settings through the stock settings methods', () => {
  const create = stock === undefined ? undefined : settingsFactory();

  test.each([false, true])('setting stacked survives a reload with concise flag %s', (flag) => {
    const manager = create?.(flag);
    if (manager === undefined || create === undefined) {
      throw new Error('no stock settings');
    }
    manager.setToolOutputDisplay('stacked');
    expect(manager.settings.general.toolResultDisplay).toBe('stacked');
    expect(manager.resolveToolOutputDisplay(flag)).toBe('stacked');
    const reloaded = create(flag);
    reloaded.settings.general = { ...manager.settings.general };
    expect(reloaded.resolveToolOutputDisplay(flag)).toBe('stacked');
  });

  test('enabling concise retains an existing stacked preference', () => {
    const manager = create?.(true);
    if (manager === undefined) {
      throw new Error('no stock settings');
    }
    manager.settings.general = { toolResultDisplay: 'stacked' };
    expect(manager.resolveToolOutputDisplay(true)).toBe('stacked');
  });

  test.each([
    [false, ['expanded', 'compact', 'stacked', 'expanded']],
    [true, ['expanded', 'concise', 'minimal', 'stacked', 'expanded']],
  ] as const)(
    'the actual Preferences row cycles every mode with concise flag %s',
    (flag, modes) => {
      const manager = create?.(flag);
      if (manager === undefined) {
        throw new Error('no stock settings');
      }
      manager.settings.general = { toolResultDisplay: 'stacked' };
      for (const mode of modes) {
        manager.displayRowAction()();
        expect(manager.getToolOutputDisplay()).toBe(mode);
        expect(manager.displayedGeneral.toolResultDisplay).toBe(
          mode === 'concise' || mode === 'minimal' ? 'compact' : mode,
        );
      }
      expect(manager.displayWrites).toEqual([...modes]);
    },
  );

  test.each([false, true])(
    'Enter cycles the displayed mode after a stale settings refresh with concise flag %s',
    (flag) => {
      const manager = create?.(flag);
      if (manager === undefined) {
        throw new Error('no stock settings');
      }
      manager.settings.general = { toolResultDisplay: 'expanded' };
      const action = manager.displayRowAction();
      manager.settings.general = { toolResultDisplay: 'stacked' };
      action();
      expect(manager.getToolOutputDisplay()).toBe(flag ? 'concise' : 'compact');
      expect(manager.displayWrites).toEqual([flag ? 'concise' : 'compact']);
    },
  );

  test.each([
    [false, ['expanded', 'compact']],
    [true, ['expanded', 'concise', 'minimal']],
  ] as const)('stock display modes round trip with concise flag %s', (flag, modes) => {
    const manager = create?.(flag);
    if (manager === undefined) {
      throw new Error('no stock settings');
    }
    for (const mode of modes) {
      manager.setToolOutputDisplay(mode);
      expect(manager.resolveToolOutputDisplay(flag)).toBe(mode);
    }
  });
});
