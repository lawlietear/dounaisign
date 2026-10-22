import platform
import sys

if sys.platform != 'win32' or sys.version_info[:2] != (3, 12) or sys.maxsize <= 2**32 or platform.machine().upper() not in ('AMD64', 'X86_64'):
    raise SystemExit('Windows x64 CPython 3.12 is required.')
