from langchain_mcp_adapters.client import MultiServerMCPClient
import asyncio

client = MultiServerMCPClient()
# Use asyncio.run to handle the coroutine
asyncio.run(client.connect_to_server_via_stdio(server_name='mcp-server', command='uv', args=['run', 'python', '-m', 'manusmcp']))
tools = client.get_tools()

shell_tools = ["shell_exec", "shell_view", "shell_wait", "shell_write_to_process", "shell_kill_process"]
fs_tools = ["file_read", "file_read_image", "file_write", "file_str_replace", "file_find_in_content", "file_find_by_name"]
browser_tools = ["browser_view", "browser_navigate", "browser_restart", "browser_click", "browser_input", "browser_move_mouse", "browser_press_key", "browser_select_option", "browser_scroll_up", "browser_scroll_down", "browser_console_exec", "browser_console_view"]

# Replace tools.filter with list comprehensions
shell_toolkit = [t for t in tools if t.name in shell_tools]
fs_toolkit = [t for t in tools if t.name in fs_tools]
browser_toolkit = [t for t in tools if t.name in browser_tools]
