import os
import sys

# Directories to ignore
IGNORE_DIRS = {
    'node_modules',
    '.git',
    '.cursor',
    'dist',
    'build',
    'venv',
    '.venv',
    'env',
    '.env',
    '__pycache__',
    'dashboard'
}

# Specific files to ignore
IGNORE_FILES = {
    'package-lock.json',
    'bun.lock',
    'yarn.lock',
    'pnpm-lock.yaml',
    'gather_code.py', # Ignore itself
    'consolidated_codebase.md', # Ignore default output file
}

# Allowed file extensions for source code
ALLOWED_EXTENSIONS = {
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.html', '.css', '.json', '.md',
    '.yml', '.yaml', '.toml', '.ini', '.cfg', '.env.example'
}

# Map extensions to markdown language identifiers for syntax highlighting
LANG_MAP = {
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.html': 'html',
    '.css': 'css',
    '.json': 'json',
    '.md': 'markdown',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.toml': 'toml',
}

def should_process(file_path, root_dir):
    # Get relative path components
    rel_path = os.path.relpath(file_path, root_dir)
    parts = rel_path.split(os.sep)
    
    # Check if any parent directory is in IGNORE_DIRS
    for part in parts[:-1]:
        if part in IGNORE_DIRS:
            return False
            
    filename = parts[-1]
    if filename in IGNORE_FILES:
        return False
        
    _, ext = os.path.splitext(filename)
    # Check for exact matches (like .env.example) or extension matches
    if filename in ALLOWED_EXTENSIONS or ext in ALLOWED_EXTENSIONS:
        return True
        
    return False

def gather_files(root_dir, output_file):
    print(f"Scanning directory: {root_dir}")
    print(f"Output will be saved to: {output_file}")
    
    processed_count = 0
    
    with open(output_file, 'w', encoding='utf-8') as outfile:
        outfile.write(f"# Consolidated Codebase\n")
        outfile.write(f"Generated from: `{root_dir}`\n\n---\n\n")
        
        for root, dirs, files in os.walk(root_dir):
            # Prune directory search to avoid walking into ignored directories
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            for file in sorted(files):
                full_path = os.path.join(root, file)
                if should_process(full_path, root_dir):
                    rel_path = os.path.relpath(full_path, root_dir)
                    _, ext = os.path.splitext(file)
                    lang = LANG_MAP.get(ext, '')
                    
                    print(f"Adding: {rel_path}")
                    outfile.write(f"## File: `{rel_path}`\n\n")
                    outfile.write(f"```{lang}\n")
                    try:
                        with open(full_path, 'r', encoding='utf-8', errors='replace') as infile:
                            outfile.write(infile.read())
                    except Exception as e:
                        outfile.write(f"// Error reading file: {str(e)}")
                    outfile.write("\n```\n\n---\n\n")
                    processed_count += 1
                    
    print(f"\nDone! Consolidated {processed_count} files into {output_file}")

if __name__ == '__main__':
    root_dir = os.path.abspath(os.path.dirname(__file__))
    output_file = os.path.join(root_dir, 'consolidated_codebase.md')
    
    if len(sys.argv) > 1:
        output_file = sys.argv[1]
        
    gather_files(root_dir, output_file)
