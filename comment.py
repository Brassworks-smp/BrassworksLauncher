import subprocess
import sys
from pathlib import Path

# Add any directories or files here that you want the script to completely bypass
MANUAL_IGNORE_PATHS = [
    'crates/portablemc'
]

def get_project_files():
    """Uses Git natively to find files, respecting .gitignore and manual skips."""
    try:
        tracked = subprocess.check_output(['git', 'ls-files'], text=True)
        untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], text=True)
        files = set((tracked + '\n' + untracked).splitlines())

        cleaned_files = []
        for f in files:
            f_str = f.strip()
            if not f_str:
                continue

            # Normalize path delimiters using unified posix format (forward slashes)
            posix_path = Path(f_str).as_posix()

            # Skip file if it lives inside any manually ignored directory
            should_ignore = any(posix_path.startswith(ignored) or f"/{ignored}/" in f"/{posix_path}/" for ignored in MANUAL_IGNORE_PATHS)
            if should_ignore:
                continue

            cleaned_files.append(f_str)

        return cleaned_files
    except subprocess.CalledProcessError:
        print("❌ Error: Must be run inside an active Git repository.", file=sys.stderr)
        sys.exit(1)

def is_line_pure_whitespace(result_list, last_newline_idx):
    """Checks if the current line constructed so far is only whitespace."""
    for idx in range(last_newline_idx, len(result_list)):
        if not result_list[idx].isspace():
            return False
    return True

def process_toml(content):
    """TOML parser. Drops comments and removes their containing lines if standalone."""
    result = []
    i, n = 0, len(content)
    in_string = False
    string_char = None
    is_triple = False
    is_escape = False
    last_newline_idx = 0

    while i < n:
        c = content[i]

        if in_string:
            result.append(c)
            if c == '\n': last_newline_idx = len(result)
            if is_escape:
                is_escape = False
            elif c == '\\' and string_char == '"':
                is_escape = True
            elif c == string_char:
                if is_triple:
                    if len(result) >= 3 and result[-3:] == [string_char] * 3:
                        in_string = False
                else:
                    in_string = False
            i += 1
            continue

        if c in '"\'':
            in_string = True
            string_char = c
            if i + 2 < n and content[i+1] == c and content[i+2] == c:
                is_triple = True
                result.extend([c, c, c])
                i += 3
            else:
                is_triple = False
                result.append(c)
                i += 1
            continue

        if c == '#':
            if is_line_pure_whitespace(result, last_newline_idx):
                result = result[:last_newline_idx]
                while i < n and content[i] != '\n':
                    i += 1
                if i < n and content[i] == '\n':
                    i += 1
            else:
                while i < n and content[i] != '\n':
                    i += 1
            continue

        result.append(c)
        if c == '\n': last_newline_idx = len(result)
        i += 1

    return "".join(result)

def process_ts(content):
    """TS/TSX parser. Drops comments and collapses blank lines; preserves JSDoc/Compiler directives."""
    result = []
    i, n = 0, len(content)
    in_string = False
    string_char = None
    is_escape = False
    last_newline_idx = 0

    while i < n:
        c = content[i]

        if in_string:
            result.append(c)
            if c == '\n': last_newline_idx = len(result)
            if is_escape:
                is_escape = False
            elif c == '\\':
                is_escape = True
            elif c == string_char:
                in_string = False
            i += 1
            continue

        if c in '"\'`':
            in_string = True
            string_char = c
            result.append(c)
            i += 1
            continue

        if c == '/' and i + 1 < n:
            next_c = content[i+1]
            if next_c == '/':
                i += 2
                comment_text = ""
                while i < n and content[i] != '\n':
                    comment_text += content[i]
                    i += 1

                if "@ts-" in comment_text or "eslint" in comment_text or "prettier" in comment_text:
                    result.append("//" + comment_text)
                elif is_line_pure_whitespace(result, last_newline_idx):
                    result = result[:last_newline_idx]
                    if i < n and content[i] == '\n':
                        i += 1
                continue

            elif next_c == '*':
                i += 2
                comment_text = ""
                while i < n - 1 and not (content[i] == '*' and content[i+1] == '/'):
                    comment_text += content[i]
                    i += 1
                if i < n - 1: i += 2

                is_jsdoc = len(comment_text) > 0 and comment_text[0] == '*'
                if is_jsdoc or "@ts-" in comment_text or "eslint" in comment_text:
                    result.append("/*" + comment_text + "*/")
                else:
                    if is_line_pure_whitespace(result, last_newline_idx):
                        forward_i = i
                        ends_line = True
                        while forward_i < n and content[forward_i] != '\n':
                            if not content[forward_i].isspace():
                                ends_line = False
                                break
                            forward_i += 1

                        if ends_line:
                            result = result[:last_newline_idx]
                            if forward_i < n and content[forward_i] == '\n':
                                forward_i += 1
                            i = forward_i
                            continue
                continue

        result.append(c)
        if c == '\n': last_newline_idx = len(result)
        i += 1

    return "".join(result)

def process_rust(content):
    """Rust parser. Drops ALL comments (including docs) and cleanly closes up empty line gaps."""
    result = []
    i, n = 0, len(content)
    in_string = False
    is_escape = False
    last_newline_idx = 0

    while i < n:
        c = content[i]

        if in_string:
            result.append(c)
            if c == '\n': last_newline_idx = len(result)
            if is_escape:
                is_escape = False
            elif c == '\\':
                is_escape = True
            elif c == '"':
                in_string = False
            i += 1
            continue

        if c == '"':
            in_string = True
            result.append(c)
            i += 1
            continue

        if c == '/' and i + 1 < n:
            next_c = content[i+1]
            if next_c == '/':
                i += 2
                standalone = is_line_pure_whitespace(result, last_newline_idx)
                while i < n and content[i] != '\n':
                    i += 1
                if standalone:
                    result = result[:last_newline_idx]
                    if i < n and content[i] == '\n':
                        i += 1
                continue

            elif next_c == '*':
                i += 2
                nest_level = 1
                while i < n - 1:
                    if content[i] == '/' and content[i+1] == '*':
                        nest_level += 1
                        i += 2
                    elif content[i] == '*' and content[i+1] == '/':
                        nest_level -= 1
                        if nest_level == 0:
                            i += 2
                            break
                        else:
                            i += 2
                    else:
                        i += 1

                if is_line_pure_whitespace(result, last_newline_idx):
                    forward_i = i
                    ends_line = True
                    while forward_i < n and content[forward_i] != '\n':
                        if not content[forward_i].isspace():
                            ends_line = False
                            break
                        forward_i += 1

                    if ends_line:
                        result = result[:last_newline_idx]
                        if forward_i < n and content[forward_i] == '\n':
                            forward_i += 1
                        i = forward_i
                        continue
                continue

        result.append(c)
        if c == '\n': last_newline_idx = len(result)
        i += 1

    return "".join(result)

def main():
    print("🔍 Scanning project files...")
    files = get_project_files()

    for file_path in files:
        path = Path(file_path)
        ext = path.suffix

        if ext not in ['.toml', '.ts', '.tsx', '.rs']:
            continue

        try:
            content = path.read_text(encoding='utf-8')
        except Exception:
            continue

        updated_content = content
        if ext == '.toml':
            updated_content = process_toml(content)
        elif ext in ['.ts', '.tsx']:
            updated_content = process_ts(content)
        elif ext == '.rs':
            updated_content = process_rust(content)

        if content != updated_content:
            path.write_text(updated_content, encoding='utf-8')
            print(f"✨ Safely cleaned: {file_path}")

    print("\n✅ Comment and empty-line cleanup complete!")

if __name__ == '__main__':
    main()