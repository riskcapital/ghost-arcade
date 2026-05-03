#!/usr/bin/env python3
"""
Simple HTTP server for SCRN Liquid Flow Visualization
Run this script and open http://localhost:8000 in your browser
"""

import http.server
import socketserver
import webbrowser
import os
from functools import partial

PORT = 8000

# Change to the directory containing this script
os.chdir(os.path.dirname(os.path.abspath(__file__)))

Handler = partial(http.server.SimpleHTTPRequestHandler, directory=os.getcwd())

print(f"\n╔══════════════════════════════════════════════════════════╗")
print(f"║  SCRN - Liquid Flow Visualization                        ║")
print(f"║  Server running at http://localhost:{PORT}                  ║")
print(f"║  Press Ctrl+C to stop                                    ║")
print(f"╚══════════════════════════════════════════════════════════╝\n")

# Open browser automatically
webbrowser.open(f'http://localhost:{PORT}')

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
