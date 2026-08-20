
'use strict';
const fs = require('fs');
const path = require('path');
const { safePath } = require('./policy');

module.exports = {
  name: 'file_op',
  description: 'Perform file operations in workspace: write, append, delete, move, copy, mkdir.',
  parameters: {
    type: 'object',
    properties: {
      op: {
        type: 'string',
        description: 'Operation: write, append, delete, move, copy, mkdir',
        enum: ['write', 'append', 'delete', 'move', 'copy', 'mkdir'],
      },
      path: {
        type: 'string',
        description: 'Target file or directory path',
      },
      content: {
        type: 'string',
        description: 'Content to write or append (required for write/append)',
        default: '',
      },
      dest: {
        type: 'string',
        description: 'Destination path (required for move/copy)',
        default: '',
      },
      recursive: {
        type: 'boolean',
        description: 'Create parent dirs for mkdir',
        default: true,
      },
      overwrite: {
        type: 'boolean',
        description: 'Allow overwriting existing file on write',
        default: true,
      },
    },
    required: ['op', 'path'],
  },

  async run(a) {
    const op = String(a.op || '').trim();
    if (!op) return { ok: false, error: 'op required' };
    let target;
    try { target = safePath(a.path); } catch (e) { return { ok: false, error: e.message }; }
    switch (op) {
      case 'write': {
        const content = String(a.content || '');
        if (!a.overwrite && fs.existsSync(target)) {
          return { ok: false, error: 'file exists, overwrite=false' };
        }
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) {
          try { fs.mkdirSync(dir, { recursive: true }); }
          catch (e) { return { ok: false, error: 'mkdir failed: ' + e.message }; }
        }
        try {
          fs.writeFileSync(target, content, 'utf8');
          const st = fs.statSync(target);
          return { ok: true, result: { op: 'write', path: target, bytes: st.size } };
        } catch (e) { return { ok: false, error: 'write failed: ' + e.message }; }
      }
      case 'append': {
        const content = String(a.content || '');
        if (!fs.existsSync(target)) return { ok: false, error: 'file does not exist' };
        try {
          fs.appendFileSync(target, content, 'utf8');
          const st = fs.statSync(target);
          return { ok: true, result: { op: 'append', path: target, bytes: st.size } };
        } catch (e) { return { ok: false, error: 'append failed: ' + e.message }; }
      }
      case 'delete': {
        if (!fs.existsSync(target)) return { ok: false, error: 'path does not exist' };
        try {
          const st = fs.statSync(target);
          if (st.isDirectory()) {
            fs.rmSync(target, { recursive: true, force: true });
          } else {
            fs.unlinkSync(target);
          }
          return { ok: true, result: { op: 'delete', path: target, type: st.isDirectory() ? 'dir' : 'file' } };
        } catch (e) { return { ok: false, error: 'delete failed: ' + e.message }; }
      }
      case 'move': {
        if (!a.dest) return { ok: false, error: 'dest required' };
        let dest;
        try { dest = safePath(a.dest); } catch (e) { return { ok: false, error: e.message }; }
        if (!fs.existsSync(target)) return { ok: false, error: 'source does not exist' };
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) {
          try { fs.mkdirSync(dir, { recursive: true }); }
          catch (e) { return { ok: false, error: 'mkdir for dest failed: ' + e.message }; }
        }
        try {
          fs.renameSync(target, dest);
          return { ok: true, result: { op: 'move', from: target, to: dest } };
        } catch (e) { return { ok: false, error: 'move failed: ' + e.message }; }
      }
      case 'copy': {
        if (!a.dest) return { ok: false, error: 'dest required' };
        let dest;
        try { dest = safePath(a.dest); } catch (e) { return { ok: false, error: e.message }; }
        if (!fs.existsSync(target)) return { ok: false, error: 'source does not exist' };
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) {
          try { fs.mkdirSync(dir, { recursive: true }); }
          catch (e) { return { ok: false, error: 'mkdir for dest failed: ' + e.message }; }
        }
        try {
          const st = fs.statSync(target);
          if (st.isDirectory()) {
            fs.cpSync(target, dest, { recursive: true });
          } else {
            fs.copyFileSync(target, dest);
          }
          return { ok: true, result: { op: 'copy', from: target, to: dest, type: st.isDirectory() ? 'dir' : 'file' } };
        } catch (e) { return { ok: false, error: 'copy failed: ' + e.message }; }
      }
      case 'mkdir': {
        if (fs.existsSync(target)) {
          const st = fs.statSync(target);
          if (st.isDirectory()) return { ok: true, result: { op: 'mkdir', path: target, existed: true } };
          return { ok: false, error: 'path exists but is not a directory' };
        }
        try {
          fs.mkdirSync(target, { recursive: !!a.recursive });
          return { ok: true, result: { op: 'mkdir', path: target, recursive: !!a.recursive } };
        } catch (e) { return { ok: false, error: 'mkdir failed: ' + e.message }; }
      }
      default:
        return { ok: false, error: 'unknown op: ' + op };
    }
  },
};
