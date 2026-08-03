import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const appPath = new URL('../App.tsx', import.meta.url);
const sidebarPath = new URL('../components/Layout/Sidebar.tsx', import.meta.url);
const legacyBuilderPath = new URL('../components/Training/TrainingModuleBuilder.tsx', import.meta.url);

test('the legacy syllabus builder is retired in favour of Training Courses', async () => {
  const [app, sidebar] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(sidebarPath, 'utf8'),
  ]);

  await assert.rejects(access(legacyBuilderPath));
  assert.doesNotMatch(app, /TrainingModuleBuilder|case 'syllabus-management'/);
  assert.doesNotMatch(sidebar, /syllabus-management|Syllabus Management/);
  assert.match(app, /pathname\.startsWith\('\/training\/syllabus'\)[\s\S]*navigate\('\/training'/);
  assert.match(app, /case 'training':[\s\S]*TrainingWorkspacePage/);
});
