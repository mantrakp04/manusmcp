import os
import re
import time
import base64
import asyncio
import subprocess
import tempfile
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field

from mcp.server.fastmcp import FastMCP, Image
from browser_use.browser.browser import Browser, BrowserConfig
from browser_use.browser.context import BrowserContext, BrowserContextConfig
from browser_use.agent.views import ActionResult
from browser_use.dom.service import DomService

from . import config

mcp = FastMCP("BaseManusMCP")

# Pydantic Models
class ShellSession(BaseModel):
    output: str = Field(default="", description="Accumulated output from the shell session")
    process: Optional[Any] = Field(default=None, description="Subprocess process object")

browser_config = BrowserConfig(
    headless=True,
    disable_security=True,
)
browser = Browser(config=browser_config)

# Create a context config with useful settings
context_config = BrowserContextConfig(
    highlight_elements=True,
    viewport_expansion=500,
    wait_for_network_idle_page_load_time=1.0,
    minimum_wait_page_load_time=0.5,
)

# Initialize browser context
browser_context = None
browser_context_lock = asyncio.Lock()

async def get_browser_context():
    """Get or create a browser context with locking to ensure thread safety"""
    global browser_context
    async with browser_context_lock:
        if browser_context is None:
            browser_context = await browser.new_context(context_config)
        return browser_context

# Session state
sessions: Dict[str, ShellSession] = {}


# Tools
@mcp.tool()
def shell_exec(
    id: str = Field(description="Unique identifier of the target shell session"),
    exec_dir: str = Field(description=f"Working directory for command execution (use {config.base_dir} as default)"),
    command: str = Field(description="Shell command to execute")
) -> str:
    """Execute commands in a specified shell session. Use for running code, installing packages, or managing files."""
    session_id = id
    exec_dir = exec_dir
    command = command
    
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
def shell_view(id: str = Field(description="Unique identifier of the target shell session")) -> str:
    """View the content of a specified shell session. Use for checking command execution results or monitoring output."""
    session_id = id
    
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
def shell_wait(
    id: str = Field(description="Unique identifier of the target shell session"),
    seconds: Optional[int] = Field(default=None, description="Wait duration in seconds")
) -> str:
    """Wait for the running process in a specified shell session to return. Use after running commands that require longer runtime."""
    session_id = id
    seconds = seconds
    
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
def shell_write_to_process(
    id: str = Field(description="Unique identifier of the target shell session"),
    input: str = Field(description="Input content to write to the process"),
    press_enter: bool = Field(description="Whether to press Enter key after input")
) -> str:
    """Write input to a running process in a specified shell session. Use for responding to interactive command prompts."""
    session_id = id
    input_text = input
    press_enter = press_enter
    
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
def shell_kill_process(
    id: str = Field(description="Unique identifier of the target shell session")
) -> str:
    """Terminate a running process in a specified shell session. Use for stopping long-running processes or handling frozen commands."""
    session_id = id
    
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
def file_read(
    file: str = Field(description=f"Path of the file to read (use {config.base_dir} as default)"),
    start_line: Optional[int] = Field(default=None, description="(Optional) Starting line to read from, 0-based"),
    end_line: Optional[int] = Field(default=None, description="(Optional) Ending line number (exclusive)"),
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")
) -> str:
    """Read file content. Use for checking file contents, analyzing logs, or reading configuration files."""
    file_path = file
    start_line = start_line
    end_line = end_line
    use_sudo = sudo
    
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
def file_read_image(
    file: str = Field(description=f"Path of the image file to read (use {config.base_dir} as default)"),
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")
) -> Dict[str, Any]:
    """Read image file content and return it as base64-encoded data. Use for viewing images, diagrams, or visual content."""
    file_path = file
    use_sudo = sudo
    
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
        
        return Image(data=image_base64)
    except Exception as e:
        return {"error": f"Error reading image file: {str(e)}"}

@mcp.tool()
def file_write(
    file: str = Field(description=f"Path of the file to write to (use {config.base_dir} as default)"),
    content: str = Field(description="Text content to write"),
    append: Optional[bool] = Field(default=False, description="(Optional) Whether to use append mode"),
    leading_newline: Optional[bool] = Field(default=False, description="(Optional) Whether to add a leading newline"),
    trailing_newline: Optional[bool] = Field(default=True, description="(Optional) Whether to add a trailing newline"),
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")
) -> str:
    """Overwrite or append content to a file. Use for creating new files, appending content, or modifying existing files."""
    file_path = file
    content = content
    append = append
    leading_newline = leading_newline
    trailing_newline = trailing_newline
    use_sudo = sudo
    
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
def file_str_replace(
    file: str = Field(description=f"Path of the file to perform replacement on (use {config.base_dir} as default)"),
    old_str: str = Field(description="Original string to be replaced"),
    new_str: str = Field(description="New string to replace with"),
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")
) -> str:
    """Replace specified string in a file. Use for updating specific content in files or fixing errors in code."""
    file_path = file
    old_str = old_str
    new_str = new_str
    use_sudo = sudo
    
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
def file_find_in_content(
    file: str = Field(description=f"Path of the file to search within (use {config.base_dir} as default)"),
    regex: str = Field(description="Regular expression pattern to match"),
    sudo: Optional[bool] = Field(default=False, description="(Optional) Whether to use sudo privileges")
) -> str:
    """Search for matching text within file content. Use for finding specific content or patterns in files."""
    file_path = file
    regex_pattern = regex
    use_sudo = sudo
    
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
def file_find_by_name(
    path: str = Field(description=f"Path of directory to search (use {config.base_dir} as default)"),
    glob: str = Field(description="Filename pattern using glob syntax wildcards")
) -> str:
    """Find files by name pattern in specified directory. Use for locating files with specific naming patterns."""
    search_path = path
    glob_pattern = glob
    
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
async def browser_view() -> Dict[str, Any]:
    """View content of the current browser page. Use for checking the latest state of previously opened pages."""
    try:
        context = await get_browser_context()
        state = await context.get_state()
        
        # Get screenshot
        screenshot_base64 = state.screenshot
        
        # Get text content from DOM
        elements_text = state.element_tree.clickable_elements_to_string()
        
        return [
            Image(data=screenshot_base64, format="jpeg"),
            f"Current URL: {state.url}\nTitle: {state.title}\n\nAvailable tabs:\n{state.tabs}\n\nInteractive elements:\n{elements_text}"
        ]
    except Exception as e:
        return {"error": f"Error processing screenshot: {str(e)}"}

@mcp.tool()
async def browser_navigate(url: str = Field(description="Complete URL to visit. Must include protocol prefix.")) -> str:
    """Navigate browser to specified URL. Use when accessing new pages is needed."""
    try:
        context = await get_browser_context()
        await context.navigate_to(url)
        return f"Successfully navigated to {url}"
    except Exception as e:
        return f"Error navigating to {url}: {str(e)}"

@mcp.tool()
async def browser_restart(url: str = Field(description="Complete URL to visit after restart. Must include protocol prefix.")) -> str:
    """Restart browser and navigate to specified URL. Use when browser state needs to be reset."""
    global browser_context
    
    try:
        # Close the existing context
        if browser_context:
            await browser_context.close()
            browser_context = None
        
        # Get a new context
        context = await get_browser_context()
        
        # Navigate to the URL
        await context.navigate_to(url)
        return f"Browser restarted and navigated to {url}"
    except Exception as e:
        return f"Error restarting browser and navigating to {url}: {str(e)}"

@mcp.tool()
async def browser_click(
    index: Optional[int] = Field(default=None, description="(Optional) Index number of the element to click"),
    coordinate_x: Optional[float] = Field(default=None, description="(Optional) X coordinate of click position"),
    coordinate_y: Optional[float] = Field(default=None, description="(Optional) Y coordinate of click position")
) -> str:
    """Click on elements in the current browser page. Use when clicking page elements is needed."""
    try:
        context = await get_browser_context()
        
        if index is not None:
            # Get the current state to access the selector map
            state = await context.get_state()
            
            if index not in state.selector_map:
                return f"Error: Element with index {index} not found in current page"
            
            # Get the element
            element_node = state.selector_map[index]
            
            # Use the browser-use click_element_node method
            try:
                await context._click_element_node(element_node)
                return f"Clicked on element at index {index}"
            except Exception as e:
                return f"Error clicking element: {str(e)}"
        elif coordinate_x is not None and coordinate_y is not None:
            # Click by coordinates using page.mouse.click()
            page = await context.get_current_page()
            await page.mouse.click(coordinate_x, coordinate_y)
            return f"Clicked at coordinates ({coordinate_x}, {coordinate_y})"
        else:
            return "Error: Either index or coordinates (x, y) must be provided"
    
    except Exception as e:
        return f"Error clicking: {str(e)}"

@mcp.tool()
async def browser_input(
    index: Optional[int] = Field(default=None, description="(Optional) Index number of the element to input text"),
    coordinate_x: Optional[float] = Field(default=None, description="(Optional) X coordinate of the element to input text"),
    coordinate_y: Optional[float] = Field(default=None, description="(Optional) Y coordinate of the element to input text"),
    text: str = Field(description="Complete text content to input"),
    press_enter: bool = Field(description="Whether to press Enter key after input")
) -> str:
    """Input text in editable elements on the current browser page. Use when filling content in input fields."""
    try:
        context = await get_browser_context()
        
        if index is not None:
            # Get the current state to access the selector map
            state = await context.get_state()
            
            if index not in state.selector_map:
                return f"Error: Element with index {index} not found in current page"
            
            # Get the element
            element_node = state.selector_map[index]
            
            # Use the browser-use input_text_element_node method
            try:
                await context._input_text_element_node(element_node, text)
                
                # Handle Enter keypress if requested
                if press_enter:
                    page = await context.get_current_page()
                    await page.keyboard.press("Enter")
                
                return f"Entered text into element at index {index}"
            except Exception as e:
                return f"Error entering text: {str(e)}"
        elif coordinate_x is not None and coordinate_y is not None:
            # Click on coordinates and then type
            page = await context.get_current_page()
            await page.mouse.click(coordinate_x, coordinate_y)
            await page.keyboard.type(text)
            
            if press_enter:
                await page.keyboard.press("Enter")
            
            return f"Entered text at coordinates ({coordinate_x}, {coordinate_y})"
        else:
            return "Error: Either index or coordinates (x, y) must be provided"
    
    except Exception as e:
        return f"Error inputting text: {str(e)}"

@mcp.tool()
async def browser_move_mouse(
    coordinate_x: float = Field(description="X coordinate of target cursor position"),
    coordinate_y: float = Field(description="Y coordinate of target cursor position")
) -> str:
    """Move cursor to specified position on the current browser page. Use when simulating user mouse movement."""
    try:
        context = await get_browser_context()
        page = await context.get_current_page()
        await page.mouse.move(coordinate_x, coordinate_y)
        return f"Mouse moved to coordinates ({coordinate_x}, {coordinate_y})"
    except Exception as e:
        return f"Error moving mouse: {str(e)}"

@mcp.tool()
async def browser_press_key(key: str = Field(description="Key name to simulate (e.g., Enter, Tab, ArrowUp), supports key combinations (e.g., Control+Enter).")) -> str:
    """Simulate key press in the current browser page. Use when specific keyboard operations are needed."""
    try:
        context = await get_browser_context()
        page = await context.get_current_page()
        await page.keyboard.press(key)
        return f"Key press simulated: {key}"
    except Exception as e:
        return f"Error pressing key: {str(e)}"

@mcp.tool()
async def browser_select_option(
    index: int = Field(description="Index number of the dropdown list element"),
    option_text: str = Field(description="Text of the option to select")
) -> str:
    """Select specified option from dropdown list element in the current browser page. Use when selecting dropdown menu options."""
    try:
        context = await get_browser_context()
        state = await context.get_state()
        
        if index not in state.selector_map:
            return f"Error: Dropdown with index {index} not found in current page"
        
        element_node = state.selector_map[index]
        
        if element_node.tag_name.lower() != 'select':
            return f"Error: Element with index {index} is not a select dropdown"
        
        # Get the page to use select_option
        page = await context.get_current_page()
        
        # Handle selection through browser-use API
        try:
            element_handle = await context.get_locate_element(element_node)
            if not element_handle:
                return f"Error: Could not locate element in DOM"
            
            await element_handle.select_option(label=option_text)
            return f"Selected option '{option_text}' from dropdown at index {index}"
        except Exception as e:
            return f"Error selecting option: {str(e)}"
    
    except Exception as e:
        return f"Error selecting option: {str(e)}"

@mcp.tool()
async def browser_scroll_up(to_top: bool = Field(description="Whether to scroll directly to page top instead of one viewport up.")) -> str:
    """Scroll up the current browser page. Use when viewing content above or returning to page top."""
    try:
        context = await get_browser_context()
        page = await context.get_current_page()
        
        if to_top:
            await page.evaluate("window.scrollTo(0, 0)")
            return "Scrolled to page top"
        else:
            viewport_height = await page.evaluate("window.innerHeight")
            await page.evaluate(f"window.scrollBy(0, -{viewport_height})")
            return "Scrolled up one viewport"
    
    except Exception as e:
        return f"Error scrolling up: {str(e)}"

@mcp.tool()
async def browser_scroll_down(to_bottom: bool = Field(description="Whether to scroll directly to page bottom instead of one viewport down.")) -> str:
    """Scroll down the current browser page. Use when viewing content below or jumping to page bottom."""
    try:
        context = await get_browser_context()
        page = await context.get_current_page()
        
        if to_bottom:
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            return "Scrolled to page bottom"
        else:
            viewport_height = await page.evaluate("window.innerHeight")
            await page.evaluate(f"window.scrollBy(0, {viewport_height})")
            return "Scrolled down one viewport"
    
    except Exception as e:
        return f"Error scrolling down: {str(e)}"

@mcp.tool()
async def browser_console_exec(javascript: str = Field(description="JavaScript code to execute. Note that the runtime environment is browser console.")) -> str:
    """Execute JavaScript code in browser console. Use when custom scripts need to be executed."""
    try:
        context = await get_browser_context()
        page = await context.get_current_page()
        result = await page.evaluate(javascript)
        return f"JavaScript executed successfully. Result: {result}"
    except Exception as e:
        return f"Error executing JavaScript: {str(e)}"

@mcp.tool()
async def browser_console_view(max_lines: Optional[int] = Field(default=100, description="(Optional) Maximum number of log lines to return.")) -> str:
    """View browser console output. Use when checking JavaScript logs or debugging page errors."""
    try:
        context = await get_browser_context()
        page = await context.get_current_page()
        
        # Execute JavaScript to get console logs
        logs = await page.evaluate(f"""() => {{
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
