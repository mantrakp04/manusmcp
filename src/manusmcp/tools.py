import os
import re
import time
import glob
import base64
import subprocess
import tempfile
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field

from gradio_client import Client
from mcp.server.fastmcp import FastMCP
from playwright.sync_api import sync_playwright

from . import config

mcp = FastMCP("ManusMCP")

# Pydantic Models
class ShellSession(BaseModel):
    output: str = Field(default="", description="Accumulated output from the shell session")
    process: Optional[Any] = Field(default=None, description="Subprocess process object")

class ShellExecParams(BaseModel):
    id: str = Field(description="Unique identifier of the target shell session")
    exec_dir: str = Field(description=f"Working directory for command execution (use {config.base_dir} as default)")
    command: str = Field(description="Shell command to execute")

class ShellViewParams(BaseModel):
    id: str = Field(description="Unique identifier of the target shell session")

class ShellWaitParams(BaseModel):
    id: str = Field(description="Unique identifier of the target shell session")
    seconds: Optional[int] = Field(default=None, description="Wait duration in seconds")

class ShellWriteToProcessParams(BaseModel):
    id: str = Field(description="Unique identifier of the target shell session")
    input: str = Field(description="Input content to write to the process")
    press_enter: bool = Field(description="Whether to press Enter key after input")

class ShellKillProcessParams(BaseModel):
    id: str = Field(description="Unique identifier of the target shell session")

class BrowserViewParams(BaseModel):
    pass

class BrowserNavigateParams(BaseModel):
    url: str = Field(description="Complete URL to visit. Must include protocol prefix.")

class BrowserRestartParams(BaseModel):
    url: str = Field(description="Complete URL to visit after restart. Must include protocol prefix.")

class BrowserClickParams(BaseModel):
    index: Optional[int] = Field(default=None, description="(Optional) Index number of the element to click")
    coordinate_x: Optional[float] = Field(default=None, description="(Optional) X coordinate of click position")
    coordinate_y: Optional[float] = Field(default=None, description="(Optional) Y coordinate of click position")

class BrowserInputParams(BaseModel):
    index: Optional[int] = Field(default=None, description="(Optional) Index number of the element to overwrite text")
    coordinate_x: Optional[float] = Field(default=None, description="(Optional) X coordinate of the element to overwrite text")
    coordinate_y: Optional[float] = Field(default=None, description="(Optional) Y coordinate of the element to overwrite text")
    text: str = Field(description="Complete text content to overwrite")
    press_enter: bool = Field(description="Whether to press Enter key after input")

class BrowserMoveMouseParams(BaseModel):
    coordinate_x: float = Field(description="X coordinate of target cursor position")
    coordinate_y: float = Field(description="Y coordinate of target cursor position")

class BrowserPressKeyParams(BaseModel):
    key: str = Field(description="Key name to simulate (e.g., Enter, Tab, ArrowUp), supports key combinations (e.g., Control+Enter).")

class BrowserSelectOptionParams(BaseModel):
    index: int = Field(description="Index number of the dropdown list element")
    option: int = Field(description="Option number to select, starting from 0.")

class BrowserScrollUpParams(BaseModel):
    to_top: Optional[bool] = Field(default=False, description="(Optional) Whether to scroll directly to page top instead of one viewport up.")

class BrowserScrollDownParams(BaseModel):
    to_bottom: Optional[bool] = Field(default=False, description="(Optional) Whether to scroll directly to page bottom instead of one viewport down.")

class BrowserConsoleExecParams(BaseModel):
    javascript: str = Field(description="JavaScript code to execute. Note that the runtime environment is browser console.")

class BrowserConsoleViewParams(BaseModel):
    max_lines: Optional[int] = Field(default=100, description="(Optional) Maximum number of log lines to return.")

class FileReadParams(BaseModel):
    file: str = Field(description=f"Path of the file to read (use {config.base_dir} as default)")
    start_line: Optional[int] = Field(default=None, description="(Optional) Starting line to read from, 0-based")
    end_line: Optional[int] = Field(default=None, description="(Optional) Ending line number (exclusive)")
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")

class FileReadImageParams(BaseModel):
    file: str = Field(description=f"Path of the image file to read (use {config.base_dir} as default)")
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")

class FileWriteParams(BaseModel):
    file: str = Field(description=f"Path of the file to write to (use {config.base_dir} as default)")
    content: str = Field(description="Text content to write")
    append: Optional[bool] = Field(default=False, description="(Optional) Whether to use append mode")
    leading_newline: Optional[bool] = Field(default=False, description="(Optional) Whether to add a leading newline")
    trailing_newline: Optional[bool] = Field(default=True, description="(Optional) Whether to add a trailing newline")
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")

class FileStrReplaceParams(BaseModel):
    file: str = Field(description=f"Path of the file to perform replacement on (use {config.base_dir} as default)")
    old_str: str = Field(description="Original string to be replaced")
    new_str: str = Field(description="New string to replace with")
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")

class FileFindInContentParams(BaseModel):
    file: str = Field(description=f"Path of the file to search within (use {config.base_dir} as default)")
    regex: str = Field(description="Regular expression pattern to match")
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")

class FileFindByNameParams(BaseModel):
    path: str = Field(description=f"Path of directory to search (use {config.base_dir} as default)")
    glob: str = Field(description="Filename pattern using glob syntax wildcards")

class BrowserInstance:
    def __init__(self):
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        
    def ensure_browser(self):
        if self.playwright is None:
            self.playwright = sync_playwright().start()
            self.browser = self.playwright.chromium.launch(headless=True)
            self.context = self.browser.new_context(viewport={"width": 1280, "height": 800})
            self.page = self.context.new_page()
        elif self.page is None or self.browser is None:
            if self.browser is None:
                self.browser = self.playwright.chromium.launch(headless=True)
            if self.context is None:
                self.context = self.browser.new_context(viewport={"width": 1280, "height": 800})
            if self.page is None:
                self.page = self.context.new_page()
    
    def restart_browser(self):
        self.close()
        self.ensure_browser()
    
    def close(self):
        if self.page:
            self.page.close()
            self.page = None
        if self.context:
            self.context.close()
            self.context = None
        if self.browser:
            self.browser.close()
            self.browser = None
        if self.playwright:
            self.playwright.stop()
            self.playwright = None

# Session state
sessions: Dict[str, ShellSession] = {}

# Omni Parser Client
client = Client(config.omni_parser_client_url, hf_token=config.hf_token)

# Initialize browser instance
browser_instance = BrowserInstance()

# Tools
@mcp.tool()
def shell_exec(params: ShellExecParams) -> str:
    """Execute commands in a specified shell session. Use for running code, installing packages, or managing files."""
    session_id = params.id
    exec_dir = params.exec_dir
    command = params.command
    
    if session_id not in sessions:
        sessions[session_id] = ShellSession()
    
    session = sessions[session_id]
    
    # Kill any existing process
    if session.process and session.process.poll() is None:
        session.process.terminate()
        try:
            session.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            session.process.kill()
    
    # Clear previous output
    session.output = ""
    
    # Execute command
    try:
        process = subprocess.Popen(
            command,
            shell=True,
            cwd=exec_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        session.process = process
        
        # Read initial output without blocking
        output = ""
        while process.poll() is None:
            line = process.stdout.readline()
            if not line:
                break
            output += line
            session.output += line
            
        # If process completed immediately, get remaining output
        if process.poll() is not None:
            remaining_output = process.stdout.read()
            output += remaining_output
            session.output += remaining_output
            
        return f"Command started in session {session_id}. Initial output: {output[:1000]}..."
    except Exception as e:
        return f"Error executing command: {str(e)}"

@mcp.tool()
def shell_view(params: ShellViewParams) -> str:
    """View the content of a specified shell session. Use for checking command execution results or monitoring output."""
    session_id = params.id
    
    if session_id not in sessions:
        return f"Session {session_id} not found"
    
    session = sessions[session_id]
    process = session.process
    
    # Read any new output
    if process and process.poll() is None:
        while True:
            line = process.stdout.readline()
            if not line:
                break
            session.output += line
    
    return session.output

@mcp.tool()
def shell_wait(params: ShellWaitParams) -> str:
    """Wait for the running process in a specified shell session to return. Use after running commands that require longer runtime."""
    session_id = params.id
    seconds = params.seconds
    
    if session_id not in sessions:
        return f"Session {session_id} not found"
    
    session = sessions[session_id]
    process = session.process
    
    if not process:
        return f"No process running in session {session_id}"
    
    if process.poll() is not None:
        return f"Process in session {session_id} already completed with return code {process.returncode}"
    
    try:
        if seconds is not None:
            # Wait with timeout
            try:
                process.wait(timeout=seconds)
            except subprocess.TimeoutExpired:
                return f"Process in session {session_id} still running after {seconds} seconds"
        else:
            # Wait indefinitely
            process.wait()
        
        # Read remaining output
        remaining_output = process.stdout.read()
        session.output += remaining_output
        
        return f"Process in session {session_id} completed with return code {process.returncode}"
    except Exception as e:
        return f"Error waiting for process: {str(e)}"

@mcp.tool()
def shell_write_to_process(params: ShellWriteToProcessParams) -> str:
    """Write input to a running process in a specified shell session. Use for responding to interactive command prompts."""
    session_id = params.id
    input_text = params.input
    press_enter = params.press_enter
    
    if session_id not in sessions:
        return f"Session {session_id} not found"
    
    session = sessions[session_id]
    process = session.process
    
    if not process:
        return f"No process running in session {session_id}"
    
    if process.poll() is not None:
        return f"Process in session {session_id} already completed with return code {process.returncode}"
    
    try:
        # Write input to process
        input_with_newline = input_text + "\n" if press_enter else input_text
        process.stdin.write(input_with_newline)
        process.stdin.flush()
        
        # Give process some time to process input
        time.sleep(0.5)
        
        # Read any new output
        while True:
            line = process.stdout.readline()
            if not line:
                break
            session.output += line
        
        return f"Input written to process in session {session_id}"
    except Exception as e:
        return f"Error writing to process: {str(e)}"

@mcp.tool()
def shell_kill_process(params: ShellKillProcessParams) -> str:
    """Terminate a running process in a specified shell session. Use for stopping long-running processes or handling frozen commands."""
    session_id = params.id
    
    if session_id not in sessions:
        return f"Session {session_id} not found"
    
    session = sessions[session_id]
    process = session.process
    
    if not process:
        return f"No process running in session {session_id}"
    
    if process.poll() is not None:
        return f"Process in session {session_id} already completed with return code {process.returncode}"
    
    try:
        # Try to terminate gracefully first
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            # Force kill if terminate doesn't work
            process.kill()
            process.wait()
        
        return f"Process in session {session_id} terminated"
    except Exception as e:
        return f"Error killing process: {str(e)}"

# Tools
@mcp.tool()
def file_read(params: FileReadParams) -> str:
    """Read file content. Use for checking file contents, analyzing logs, or reading configuration files."""
    file_path = params.file
    start_line = params.start_line
    end_line = params.end_line
    use_sudo = params.sudo
    
    try:
        # Use sudo if requested
        if use_sudo:
            cmd = ["sudo", "cat", file_path]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            content = result.stdout
        else:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        
        # Apply line filters if specified
        if start_line is not None or end_line is not None:
            lines = content.splitlines()
            start = start_line if start_line is not None else 0
            end = end_line if end_line is not None else len(lines)
            content = '\n'.join(lines[start:end])
        
        return content
    except Exception as e:
        return f"Error reading file: {str(e)}"

@mcp.tool()
def file_read_image(params: FileReadImageParams) -> Dict[str, Any]:
    """Read image file content and return it as base64-encoded data. Use for viewing images, diagrams, or visual content."""
    file_path = params.file
    use_sudo = params.sudo
    
    try:
        # Determine image type from file extension
        file_ext = os.path.splitext(file_path)[1].lower()
        content_type = "image/jpeg"  # Default content type
        
        if file_ext in ['.png']:
            content_type = "image/png"
        elif file_ext in ['.jpg', '.jpeg']:
            content_type = "image/jpeg"
        elif file_ext in ['.gif']:
            content_type = "image/gif"
        elif file_ext in ['.bmp']:
            content_type = "image/bmp"
        elif file_ext in ['.webp']:
            content_type = "image/webp"
        elif file_ext in ['.svg']:
            content_type = "image/svg+xml"
        
        # Read the file content in binary mode
        if use_sudo:
            cmd = ["sudo", "cat", file_path]
            result = subprocess.run(cmd, capture_output=True, check=True)
            image_bytes = result.stdout
        else:
            with open(file_path, 'rb') as f:
                image_bytes = f.read()
        
        # Encode image data as base64
        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
        
        return {
            "content": [
                {"type": "image", "data": f"data:{content_type};base64,{image_base64}"}
            ],
            "filename": os.path.basename(file_path),
            "file_size": len(image_bytes)
        }
    except Exception as e:
        return {"error": f"Error reading image file: {str(e)}"}

@mcp.tool()
def file_write(params: FileWriteParams) -> str:
    """Overwrite or append content to a file. Use for creating new files, appending content, or modifying existing files."""
    file_path = params.file
    content = params.content
    append = params.append
    leading_newline = params.leading_newline
    trailing_newline = params.trailing_newline
    use_sudo = params.sudo
    
    try:
        # Process content with optional newlines
        processed_content = content
        if leading_newline:
            processed_content = '\n' + processed_content
        if trailing_newline and not processed_content.endswith('\n'):
            processed_content = processed_content + '\n'
        
        # Use sudo if requested
        if use_sudo:
            mode = 'a' if append else 'w'
            cmd = ["sudo", "tee"]
            if append:
                cmd.append("-a")
            cmd.append(file_path)
            
            result = subprocess.run(
                cmd, 
                input=processed_content, 
                capture_output=True, 
                text=True, 
                check=True
            )
            return f"File written successfully: {file_path}"
        else:
            # Ensure directory exists
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            
            # Write content
            mode = 'a' if append else 'w'
            with open(file_path, mode, encoding='utf-8') as f:
                f.write(processed_content)
            
            return f"File written successfully: {file_path}"
    except Exception as e:
        return f"Error writing file: {str(e)}"

@mcp.tool()
def file_str_replace(params: FileStrReplaceParams) -> str:
    """Replace specified string in a file. Use for updating specific content in files or fixing errors in code."""
    file_path = params.file
    old_str = params.old_str
    new_str = params.new_str
    use_sudo = params.sudo
    
    try:
        # Read file content
        if use_sudo:
            cmd = ["sudo", "cat", file_path]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            content = result.stdout
        else:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        
        # Perform replacement
        new_content = content.replace(old_str, new_str)
        
        # Count replacements
        replacement_count = content.count(old_str)
        
        # Write back if changes were made
        if content != new_content:
            if use_sudo:
                cmd = ["sudo", "tee", file_path]
                result = subprocess.run(
                    cmd, 
                    input=new_content, 
                    capture_output=True, 
                    text=True, 
                    check=True
                )
            else:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
            
            return f"Replaced {replacement_count} occurrence(s) in {file_path}"
        else:
            return f"No replacements made. String not found in {file_path}"
    except Exception as e:
        return f"Error replacing text in file: {str(e)}"

@mcp.tool()
def file_find_in_content(params: FileFindInContentParams) -> str:
    """Search for matching text within file content. Use for finding specific content or patterns in files."""
    file_path = params.file
    regex_pattern = params.regex
    use_sudo = params.sudo
    
    try:
        # Read file content
        if use_sudo:
            cmd = ["sudo", "cat", file_path]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            content = result.stdout
        else:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        
        # Compile regex
        pattern = re.compile(regex_pattern)
        
        # Find all matches
        matches = pattern.findall(content)
        
        # Find line numbers for matches
        lines = content.splitlines()
        match_data = []
        
        for i, line in enumerate(lines):
            if pattern.search(line):
                match_data.append((i+1, line))
        
        # Format output
        if match_data:
            result = f"Found {len(matches)} matches in {file_path}:\n"
            for line_num, line in match_data:
                result += f"Line {line_num}: {line[:100]}" + ("..." if len(line) > 100 else "") + "\n"
            return result
        else:
            return f"No matches found in {file_path}"
    except Exception as e:
        return f"Error searching in file: {str(e)}"

@mcp.tool()
def file_find_by_name(params: FileFindByNameParams) -> str:
    """Find files by name pattern in specified directory. Use for locating files with specific naming patterns."""
    search_path = params.path
    glob_pattern = params.glob
    
    try:
        # Create full pattern
        full_pattern = os.path.join(search_path, glob_pattern)
        
        # Find matching files
        matching_files = glob.glob(full_pattern)
        
        # Format output
        if matching_files:
            result = f"Found {len(matching_files)} matching files:\n"
            for file_path in matching_files:
                result += f"{file_path}\n"
            return result
        else:
            return f"No files matching '{glob_pattern}' found in {search_path}"
    except Exception as e:
        return f"Error searching for files: {str(e)}"

@mcp.tool()
def browser_view(params: BrowserViewParams) -> Dict[str, Any]:
    """View content of the current browser page. Use for checking the latest state of previously opened pages."""
    try:
        browser_instance.ensure_browser()
        if browser_instance.page is None:
            return {"error": "Browser page not initialized"}
        
        # Take screenshot
        screenshot_bytes = browser_instance.page.screenshot()
        
        # Create a temporary file to store the screenshot
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
            temp_file_path = temp_file.name
            temp_file.write(screenshot_bytes)
        
        try:
            # Use OmniParser to extract text from the screenshot
            result = client.predict(
                "/process",
                [
                    temp_file_path,  # image_input
                    0.05,            # box_threshold
                    0.1,             # iou_threshold
                    True,            # use_paddleocr
                    640              # imgsz
                ]
            )
            
            # Extract the parsed text from the result
            parsed_screenshot_bytes = None
            parsed_text = None
            
            if isinstance(result, list) and len(result) > 1:
                parsed_screenshot_bytes = result[0]
                parsed_text = result[1]
            else:
                raise ValueError("Invalid result format from OmniParser")
            
            # Convert bytes to base64 strings
            screenshot_base64 = base64.b64encode(screenshot_bytes).decode('utf-8')
            parsed_screenshot_base64 = base64.b64encode(parsed_screenshot_bytes).decode('utf-8') if parsed_screenshot_bytes else None
            
            return {
                "content": [
                    {"type": "image", "data": f"data:image/png;base64,{screenshot_base64}"},
                    {"type": "image", "data": f"data:image/png;base64,{parsed_screenshot_base64}"},
                    {"type": "text", "text": parsed_text}
                ]
            }
            
        except Exception as e:
            return {"error": f"Error processing screenshot: {str(e)}"}
        finally:
            # Clean up the temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
    
    except Exception as e:
        return {"error": f"Error taking screenshot: {str(e)}"}

@mcp.tool()
def browser_navigate(params: BrowserNavigateParams) -> str:
    """Navigate browser to specified URL. Use when accessing new pages is needed."""
    url = params.url
    
    try:
        browser_instance.ensure_browser()
        browser_instance.page.goto(url, wait_until="networkidle")
        return f"Successfully navigated to {url}"
    except Exception as e:
        return f"Error navigating to {url}: {str(e)}"

@mcp.tool()
def browser_restart(params: BrowserRestartParams) -> str:
    """Restart browser and navigate to specified URL. Use when browser state needs to be reset."""
    url = params.url
    
    try:
        browser_instance.restart_browser()
        browser_instance.page.goto(url, wait_until="networkidle")
        return f"Browser restarted and navigated to {url}"
    except Exception as e:
        return f"Error restarting browser and navigating to {url}: {str(e)}"

@mcp.tool()
def browser_click(params: BrowserClickParams) -> str:
    """Click on elements in the current browser page. Use when clicking page elements is needed."""
    index = params.index
    x = params.coordinate_x
    y = params.coordinate_y
    
    try:
        browser_instance.ensure_browser()
        
        if index is not None:
            # Click by element index
            elements = browser_instance.page.query_selector_all("a, button, input[type='submit'], input[type='button'], div[role='button'], [onclick]")
            if 0 <= index < len(elements):
                elements[index].click()
                return f"Clicked on element at index {index}"
            else:
                return f"Error: Index {index} is out of range (0-{len(elements)-1})"
        elif x is not None and y is not None:
            # Click by coordinates
            browser_instance.page.mouse.click(x, y)
            return f"Clicked at coordinates ({x}, {y})"
        else:
            return "Error: Either index or coordinates (x, y) must be provided"
    
    except Exception as e:
        return f"Error clicking: {str(e)}"

@mcp.tool()
def browser_input(params: BrowserInputParams) -> str:
    """Overwrite text in editable elements on the current browser page. Use when filling content in input fields."""
    index = params.index
    x = params.coordinate_x
    y = params.coordinate_y
    text = params.text
    press_enter = params.press_enter
    
    try:
        browser_instance.ensure_browser()
        
        if index is not None:
            # Input by element index
            elements = browser_instance.page.query_selector_all("input:not([type='submit']):not([type='button']), textarea, [contenteditable='true']")
            if 0 <= index < len(elements):
                element = elements[index]
                element.click()
                element.fill(text)
                if press_enter:
                    element.press("Enter")
                return f"Text input completed at element index {index}"
            else:
                return f"Error: Index {index} is out of range (0-{len(elements)-1})"
        elif x is not None and y is not None:
            # Input by coordinates
            browser_instance.page.mouse.click(x, y)
            browser_instance.page.keyboard.type(text)
            if press_enter:
                browser_instance.page.keyboard.press("Enter")
            return f"Text input completed at coordinates ({x}, {y})"
        else:
            return "Error: Either index or coordinates (x, y) must be provided"
    
    except Exception as e:
        return f"Error inputting text: {str(e)}"

@mcp.tool()
def browser_move_mouse(params: BrowserMoveMouseParams) -> str:
    """Move cursor to specified position on the current browser page. Use when simulating user mouse movement."""
    x = params.coordinate_x
    y = params.coordinate_y
    
    try:
        browser_instance.ensure_browser()
        browser_instance.page.mouse.move(x, y)
        return f"Mouse moved to coordinates ({x}, {y})"
    except Exception as e:
        return f"Error moving mouse: {str(e)}"

@mcp.tool()
def browser_press_key(params: BrowserPressKeyParams) -> str:
    """Simulate key press in the current browser page. Use when specific keyboard operations are needed."""
    key = params.key
    
    try:
        browser_instance.ensure_browser()
        browser_instance.page.keyboard.press(key)
        return f"Key press simulated: {key}"
    except Exception as e:
        return f"Error pressing key: {str(e)}"

@mcp.tool()
def browser_select_option(params: BrowserSelectOptionParams) -> str:
    """Select specified option from dropdown list element in the current browser page. Use when selecting dropdown menu options."""
    index = params.index
    option = params.option
    
    try:
        browser_instance.ensure_browser()
        
        # Get all select elements
        select_elements = browser_instance.page.query_selector_all("select")
        
        if 0 <= index < len(select_elements):
            select_element = select_elements[index]
            
            # Get all options in this select element
            options = select_element.query_selector_all("option")
            
            if 0 <= option < len(options):
                option_value = options[option].get_attribute("value")
                select_element.select_option(value=option_value)
                return f"Selected option {option} from dropdown at index {index}"
            else:
                return f"Error: Option {option} is out of range (0-{len(options)-1})"
        else:
            return f"Error: Index {index} is out of range (0-{len(select_elements)-1})"
    
    except Exception as e:
        return f"Error selecting option: {str(e)}"

@mcp.tool()
def browser_scroll_up(params: BrowserScrollUpParams) -> str:
    """Scroll up the current browser page. Use when viewing content above or returning to page top."""
    to_top = params.to_top
    
    try:
        browser_instance.ensure_browser()
        
        if to_top:
            browser_instance.page.evaluate("window.scrollTo(0, 0)")
            return "Scrolled to page top"
        else:
            viewport_height = browser_instance.page.evaluate("window.innerHeight")
            browser_instance.page.evaluate(f"window.scrollBy(0, -{viewport_height})")
            return "Scrolled up one viewport"
    
    except Exception as e:
        return f"Error scrolling up: {str(e)}"

@mcp.tool()
def browser_scroll_down(params: BrowserScrollDownParams) -> str:
    """Scroll down the current browser page. Use when viewing content below or jumping to page bottom."""
    to_bottom = params.to_bottom
    
    try:
        browser_instance.ensure_browser()
        
        if to_bottom:
            browser_instance.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            return "Scrolled to page bottom"
        else:
            viewport_height = browser_instance.page.evaluate("window.innerHeight")
            browser_instance.page.evaluate(f"window.scrollBy(0, {viewport_height})")
            return "Scrolled down one viewport"
    
    except Exception as e:
        return f"Error scrolling down: {str(e)}"

@mcp.tool()
def browser_console_exec(params: BrowserConsoleExecParams) -> str:
    """Execute JavaScript code in browser console. Use when custom scripts need to be executed."""
    javascript = params.javascript
    
    try:
        browser_instance.ensure_browser()
        result = browser_instance.page.evaluate(javascript)
        return f"JavaScript executed successfully. Result: {result}"
    except Exception as e:
        return f"Error executing JavaScript: {str(e)}"

@mcp.tool()
def browser_console_view(params: BrowserConsoleViewParams) -> str:
    """View browser console output. Use when checking JavaScript logs or debugging page errors."""
    max_lines = params.max_lines
    
    try:
        browser_instance.ensure_browser()
        
        # Execute JavaScript to get console logs (this is a simplification and might require adjustment)
        logs = browser_instance.page.evaluate(f"""() => {{
            const maxLogs = {max_lines};
            if (window._consoleLogs === undefined) {{
                window._consoleLogs = [];
                const originalConsoleLog = console.log;
                const originalConsoleError = console.error;
                const originalConsoleWarn = console.warn;
                const originalConsoleInfo = console.info;
                
                console.log = function() {{
                    window._consoleLogs.push({{ type: 'log', message: Array.from(arguments).join(' ') }});
                    originalConsoleLog.apply(console, arguments);
                }};
                
                console.error = function() {{
                    window._consoleLogs.push({{ type: 'error', message: Array.from(arguments).join(' ') }});
                    originalConsoleError.apply(console, arguments);
                }};
                
                console.warn = function() {{
                    window._consoleLogs.push({{ type: 'warning', message: Array.from(arguments).join(' ') }});
                    originalConsoleWarn.apply(console, arguments);
                }};
                
                console.info = function() {{
                    window._consoleLogs.push({{ type: 'info', message: Array.from(arguments).join(' ') }});
                    originalConsoleInfo.apply(console, arguments);
                }};
            }}
            
            return window._consoleLogs.slice(-maxLogs);
        }}""")
        
        if not logs:
            return "No console logs available"
        
        # Format logs
        formatted_logs = []
        for log in logs:
            log_type = log.get("type", "log")
            message = log.get("message", "")
            formatted_logs.append(f"[{log_type.upper()}] {message}")
        
        return "\n".join(formatted_logs)
    
    except Exception as e:
        return f"Error viewing console: {str(e)}"
