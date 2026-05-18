import type { AriaProject } from '../../core/types';

function cloneProjectRecord(project: AriaProject): Record<string, unknown> {
  return JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
}

export function buildProjectCreationTemplate(project?: AriaProject): Record<string, unknown> {
  if (!project) {
    return {
      ID_PROJETO: 0,
      NO_PROJETO: '',
      TX_PATH: '',
      REST_CUSTOM: [],
    };
  }

  const template = cloneProjectRecord(project);
  for (const [key, value] of Object.entries(template)) {
    if (Array.isArray(value)) {
      template[key] = [];
    }
  }

  template.ID_PROJETO = 0;
  template.NO_PROJETO = '';
  template.TX_PATH = '';
  template.REST_CUSTOM = [];
  return template;
}