#!/usr/bin/env node
'use strict';

// Prints the GitHub release notes: CHANGELOG section of the current version + install notes.
const fs = require('fs');
const path = require('path');
const { changelogSection } = require('../src/shared/changelog');

const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const section = changelogSection(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
const footer = fs.readFileSync(path.join(root, '.github', 'release-notes.md'), 'utf8');
process.stdout.write(`${section ? `## Nouveautés de la v${version}\n\n${section}\n\n` : ''}${footer}`);
