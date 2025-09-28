import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Whitelist templates that clients are allowed to request
const allowedTemplates = new Set([
  'cursor-helper-automated.ps1.template',
  'cursor-helper-automated.sh.template',
  'cursor-helper.ps1.template',
  'cursor-helper.sh.template'
]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || '';

    if (!allowedTemplates.has(name)) {
      return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });
    }

    const templatePath = path.join(process.cwd(), 'apps', 'web', 'lib', 'script-templates', name);
    const template = fs.readFileSync(templatePath, 'utf8');

    return new NextResponse(template, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  } catch (error) {
    console.error('Failed to read script template:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}


