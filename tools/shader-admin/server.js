// Shader Admin API Server
// Provides filesystem access for the shader admin UI

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ISF_DIR = path.join(PROJECT_ROOT, 'public', 'ISF');
const NEW_SHADERS_DIR = path.join(PROJECT_ROOT, 'new-shaders');
const MANIFEST_PATH = path.join(ISF_DIR, 'manifest.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── List all .fs files in public/ISF/ ─────────────────────────────────────
app.get('/api/shaders', (req, res) => {
  try {
    const files = [];
    const walkDir = (dir, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'thumbnails') {
          walkDir(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.isFile() && entry.name.endsWith('.fs')) {
          files.push(prefix ? `${prefix}/${entry.name}` : entry.name);
        }
      }
    };
    walkDir(ISF_DIR);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Read a shader file ────────────────────────────────────────────────────
app.get('/api/shader/:filename(*)', (req, res) => {
  try {
    const filePath = path.join(ISF_DIR, req.params.filename);
    if (!filePath.startsWith(ISF_DIR)) return res.status(403).json({ error: 'Forbidden' });
    const code = fs.readFileSync(filePath, 'utf-8');
    res.json({ code, filename: req.params.filename });
  } catch (err) {
    res.status(404).json({ error: `Shader not found: ${err.message}` });
  }
});

// ─── List new shaders ──────────────────────────────────────────────────────
app.get('/api/new-shaders', (req, res) => {
  try {
    if (!fs.existsSync(NEW_SHADERS_DIR)) return res.json({ files: [] });
    const files = fs.readdirSync(NEW_SHADERS_DIR).filter(f => f.endsWith('.fs'));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Read manifest ─────────────────────────────────────────────────────────
app.get('/api/manifest', (req, res) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Save manifest ─────────────────────────────────────────────────────────
app.post('/api/manifest', (req, res) => {
  try {
    const manifest = req.body;
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    res.json({ ok: true, count: manifest.shaders?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Import shader from new-shaders/ to public/ISF/ ───────────────────────
app.post('/api/import-shader', (req, res) => {
  try {
    const { filename } = req.body;
    const src = path.join(NEW_SHADERS_DIR, filename);
    const dest = path.join(ISF_DIR, filename);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Source file not found' });
    fs.copyFileSync(src, dest);
    res.json({ ok: true, imported: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update a single shader entry in manifest ─────────────────────────────
app.patch('/api/shader-entry', (req, res) => {
  try {
    const { file, updates } = req.body;
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const entry = manifest.shaders.find(s => s.file === file);
    if (!entry) return res.status(404).json({ error: `Shader ${file} not in manifest` });
    Object.assign(entry, updates);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Save thumbnail ─────────────────────────────────────────────────────────
app.post('/api/thumbnail', (req, res) => {
  try {
    const { filename, dataUrl } = req.body;
    const thumbDir = path.join(ISF_DIR, 'thumbnails');
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const thumbName = filename.replace(/\.fs$/, '.jpg').replace(/\//g, '_');
    fs.writeFileSync(path.join(thumbDir, thumbName), buffer);
    res.json({ ok: true, path: thumbName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get thumbnail ──────────────────────────────────────────────────────────
app.get('/api/thumbnail/:filename', (req, res) => {
  try {
    const thumbDir = path.join(ISF_DIR, 'thumbnails');
    const thumbName = req.params.filename.replace(/\.fs$/, '.jpg').replace(/\//g, '_');
    const thumbPath = path.join(thumbDir, thumbName);
    if (fs.existsSync(thumbPath)) {
      res.sendFile(thumbPath);
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List existing thumbnails ───────────────────────────────────────────────
app.get('/api/thumbnails', (req, res) => {
  try {
    const thumbDir = path.join(ISF_DIR, 'thumbnails');
    if (!fs.existsSync(thumbDir)) return res.json({ files: [] });
    res.json({ files: fs.readdirSync(thumbDir).filter(f => f.endsWith('.jpg')) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk update tier for multiple shaders ─────────────────────────────────
app.post('/api/bulk-tier', (req, res) => {
  try {
    const { files, tier } = req.body;
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    let updated = 0;
    for (const entry of manifest.shaders) {
      if (files.includes(entry.file)) {
        entry.tier = tier;
        updated++;
      }
    }
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Scan for new .fs files anywhere in project ─────────────────────────────
app.get('/api/scan', (req, res) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const knownFiles = new Set(manifest.shaders.map(s => s.file));

    // Also check what's already in public/ISF
    const isfFiles = [];
    const walkDir = (dir, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'thumbnails' && entry.name !== 'node_modules') {
          walkDir(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.isFile() && entry.name.endsWith('.fs')) {
          isfFiles.push(prefix ? `${prefix}/${entry.name}` : entry.name);
        }
      }
    };
    walkDir(ISF_DIR);

    // Find .fs files in ISF dir that aren't in manifest
    const unmanagedISF = isfFiles.filter(f => !knownFiles.has(f));

    // Scan new-shaders/ directory
    const newShaderFiles = [];
    if (fs.existsSync(NEW_SHADERS_DIR)) {
      const entries = fs.readdirSync(NEW_SHADERS_DIR).filter(f => f.endsWith('.fs'));
      for (const f of entries) {
        if (!knownFiles.has(f)) newShaderFiles.push(f);
      }
    }

    // Scan common locations in the project for .fs files
    const scanDirs = [
      path.join(PROJECT_ROOT, 'shaders'),
      path.join(PROJECT_ROOT, 'src', 'shaders'),
      path.join(PROJECT_ROOT, 'assets', 'shaders'),
      path.join(PROJECT_ROOT, 'new-shaders'),
    ];

    const externalFiles = [];
    for (const scanDir of scanDirs) {
      if (!fs.existsSync(scanDir)) continue;
      try {
        const files = fs.readdirSync(scanDir).filter(f => f.endsWith('.fs'));
        for (const f of files) {
          if (!knownFiles.has(f) && !newShaderFiles.includes(f)) {
            externalFiles.push({ file: f, dir: path.relative(PROJECT_ROOT, scanDir) });
          }
        }
      } catch {}
    }

    res.json({
      unmanagedISF,      // .fs files in public/ISF/ not in manifest
      newShaderFiles,     // .fs files in new-shaders/ not in manifest
      externalFiles,      // .fs files found elsewhere in project
      totalManifest: manifest.shaders.length,
      totalOnDisk: isfFiles.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Import shader from any project location ────────────────────────────────
app.post('/api/import-from', (req, res) => {
  try {
    const { filename, sourceDir } = req.body;
    const src = path.join(PROJECT_ROOT, sourceDir, filename);
    const dest = path.join(ISF_DIR, filename);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Source file not found' });
    // Don't overwrite existing
    if (fs.existsSync(dest)) return res.status(409).json({ error: 'File already exists in ISF directory' });
    fs.copyFileSync(src, dest);
    res.json({ ok: true, imported: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 5557;
app.listen(PORT, () => {
  console.log(`Shader Admin API running on http://localhost:${PORT}`);
  console.log(`ISF directory: ${ISF_DIR}`);
  console.log(`New shaders: ${NEW_SHADERS_DIR}`);
});
