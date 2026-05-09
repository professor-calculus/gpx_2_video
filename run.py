#!/usr/bin/env python3
import subprocess
import os
import signal
import sys
import time
from threading import Thread
from queue import Queue, Empty

from rich.console import Console
from rich.layout import Layout
from rich.panel import Panel
from rich.live import Live
from rich.text import Text
from rich.table import Table
from rich.columns import Columns
from rich.prompt import Prompt

class ProcessManager:
    def __init__(self, command, cwd=None, name="Process"):
        self.command = command
        self.cwd = cwd
        self.name = name
        self.process = None
        self.output_queue = Queue()
        self.status = "Stopped"
        self.log_buffer = []
        self.max_logs = 100

    def start(self):
        self.status = "Starting..."
        try:
            self.process = subprocess.Popen(
                self.command,
                cwd=self.cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                shell=True,
                preexec_fn=os.setsid
            )
            self.status = "Running"
            Thread(target=self._read_output, daemon=True).start()
        except Exception as e:
            self.status = f"Error: {e}"

    def _read_output(self):
        for line in iter(self.process.stdout.readline, ""):
            self.log_buffer.append(line.strip())
            if len(self.log_buffer) > self.max_logs:
                self.log_buffer.pop(0)
        self.process.stdout.close()
        return_code = self.process.wait()
        self.status = f"Exited ({return_code})"

    def stop(self):
        if self.process:
            self.status = "Stopping..."
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
            except Exception:
                pass
            self.status = "Stopped"

def create_layout(backend, frontend):
    layout = Layout()
    layout.split_column(
        Layout(name="header", size=3),
        Layout(name="main"),
        Layout(name="footer", size=3),
    )
    layout["main"].split_row(
        Layout(name="backend_panel"),
        Layout(name="frontend_panel"),
    )
    return layout

def get_logs_panel(manager, title, border_style):
    logs = "\n".join(manager.log_buffer[-15:])
    return Panel(
        Text(logs, overflow="ellipsis", style="dim"),
        title=f"{title} - {manager.status}",
        border_style=border_style,
    )

def ensure_cesium_token(console):
    # Load existing .env if it exists
    token = os.getenv("CESIUM_ION_TOKEN")
    
    if not token or token == "YOUR_TOKEN_HERE" or token.strip() == "":
        console.print(Panel("[bold yellow]Cesium Ion Token Missing[/]\n\nYou need a Cesium Ion token to render the 3D terrain and imagery.\nGet one for free at: [blue]https://ion.cesium.com/[/]", border_style="yellow"))
        token = Prompt.ask("Please enter your Cesium Ion Token").strip()
        
        if token:
            # Simple .env update logic
            lines = []
            updated = False
            if os.path.exists(".env"):
                with open(".env", "r") as f:
                    lines = f.readlines()
                
                for i, line in enumerate(lines):
                    if line.strip().startswith("CESIUM_ION_TOKEN="):
                        lines[i] = f"CESIUM_ION_TOKEN={token}\n"
                        updated = True
                        break
            
            if not updated:
                lines.append(f"CESIUM_ION_TOKEN={token}\n")
            
            with open(".env", "w") as f:
                f.writelines(lines)
            
            os.environ["CESIUM_ION_TOKEN"] = token
            console.print("[bold green]Token saved to .env[/]\n")
        else:
            console.print("[bold red]Warning: No token provided. The application may not render correctly.[/]\n")
            time.sleep(2)

def main():
    console = Console()
    
    # Simple .env loader
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                if "=" in line and not line.startswith("#"):
                    parts = line.strip().split("=", 1)
                    if len(parts) == 2:
                        os.environ[parts[0]] = parts[1]

    ensure_cesium_token(console)
    
    # Path to venv python
    venv_python = os.path.join(os.getcwd(), "venv", "bin", "python")
    if not os.path.exists(venv_python):
        venv_python = "python3"

    backend = ProcessManager(f"{venv_python} main.py", name="Backend")
    frontend = ProcessManager("npm run dev", cwd="frontend", name="Frontend")

    backend.start()
    frontend.start()

    layout = create_layout(backend, frontend)
    
    header_content = Panel(
        Text("GPX-2-Video Orchestrator", justify="center", style="bold cyan"),
        border_style="cyan"
    )
    
    footer_content = Panel(
        Text("Press Ctrl+C to stop all services", justify="center", style="bold red"),
        border_style="red"
    )

    try:
        with Live(layout, refresh_per_second=4, screen=True) as live:
            while True:
                layout["header"].update(header_content)
                
                # Update panels
                layout["main"]["backend_panel"].update(
                    get_logs_panel(backend, "[bold yellow]Backend (FastAPI)[/]", "yellow")
                )
                
                # Attempt to find Vite port from logs if possible, or assume 5173
                frontend_title = "[bold green]Frontend (Vite)[/]"
                layout["main"]["frontend_panel"].update(
                    get_logs_panel(frontend, frontend_title, "green")
                )

                # Info footer
                info_table = Table.grid(expand=True)
                info_table.add_column(justify="center", ratio=1)
                info_table.add_column(justify="center", ratio=1)
                info_table.add_row(
                    Text("Backend: http://localhost:8000", style="yellow"),
                    Text("Frontend: http://localhost:5173", style="green")
                )
                layout["footer"].update(Panel(info_table, border_style="blue"))
                
                time.sleep(0.25)
    except KeyboardInterrupt:
        console.print("\n[bold red]Stopping services...[/]")
        backend.stop()
        frontend.stop()
        console.print("[bold green]All services stopped.[/]")

if __name__ == "__main__":
    main()
