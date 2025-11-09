# Todo List MCP Server

A Model Context Protocol (MCP) server that provides a comprehensive API for managing todo items.

<a href="https://glama.ai/mcp/servers/kh39rjpplx">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/kh39rjpplx/badge" alt="Todo List Server MCP server" />
</a>

> **📚 Learning Resource**: This project is designed as an educational example of MCP implementation. See [GUIDE.md](GUIDE.md) for a comprehensive explanation of how the project works and why things are implemented the way they are.

## Features

- **Create todos**: Add new tasks with title and markdown description
- **Update todos**: Modify existing tasks
- **Complete todos**: Mark tasks as done
- **Delete todos**: Remove tasks from the list
- **Search todos**: Find tasks by title or creation date
- **Summarize todos**: Get a quick overview of active tasks

## Tools

This MCP server exposes the following tools:

1. `create-todo`: Create a new todo item
2. `list-todos`: List all todos
3. `get-todo`: Get a specific todo by ID
4. `update-todo`: Update a todo's title or description
5. `complete-todo`: Mark a todo as completed
6. `delete-todo`: Delete a todo
7. `search-todos-by-title`: Search todos by title (case-insensitive partial match)
8. `search-todos-by-date`: Search todos by creation date (format: YYYY-MM-DD)
9. `list-active-todos`: List all non-completed todos
10. `summarize-active-todos`: Generate a summary of all active (non-completed) todos

## Installation

```bash
# Clone the repository
git clone https://github.com/RegiByte/todo-list-mcp.git
cd todo-list-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Starting the Server

```bash
npm start
```

By default, the server listens on `http://127.0.0.1:4041`. The SSE stream is exposed at `/sse` and the HTTP POST endpoint for client messages is `/messages`. These values can be overridden with the following environment variables:

- `TODO_HTTP_HOST` – Hostname or IP address to bind (default: `127.0.0.1`)
- `TODO_HTTP_PORT` – Port to listen on (default: `4041`)
- `TODO_HTTP_SSE_PATH` – Path for the SSE endpoint (default: `/sse`)
- `TODO_HTTP_MESSAGES_PATH` – Path for the HTTP POST endpoint (default: `/messages`)
- `TODO_HTTP_AUTH_TOKEN` – Optional token required in the `Authorization` header
- `TODO_HTTP_AUTH_SCHEME` – Authorization scheme prefix (default: `Bearer`)

When the server boots, it logs the full URLs it is serving so you can confirm the configuration.

If `TODO_HTTP_AUTH_TOKEN` is set, every request to the SSE and message endpoints must include:

```
Authorization: Bearer <your-token>
```

Adjust the header value if you customized `TODO_HTTP_AUTH_SCHEME`.

### Configuring with Claude for Desktop

#### Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "todo": {
      "type": "http",
      "url": "http://127.0.0.1:4041/sse",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

#### Cursor

- Go to "Cursor Settings" → MCP
- Add a new MCP server with an **HTTP** transport
- Set the server URL to `http://127.0.0.1:4041/sse` (update host/port if you changed the defaults)
- Add a default header for `Authorization` if you configured `TODO_HTTP_AUTH_TOKEN`
- Make sure the Todo MCP server is running (`npm start`) before connecting from Cursor

### Example Commands

When using with Claude for Desktop or Cursor, you can try:

- "Create a todo to learn MCP with a description explaining why MCP is useful"
- "List all my active todos"
- "Create a todo for tomorrow's meeting with details about the agenda in markdown"
- "Mark my learning MCP todo as completed"
- "Summarize all my active todos"

## Project Structure

This project follows a clear separation of concerns to make the code easy to understand:

```
src/
├── models/       # Data structures and validation schemas
├── services/     # Business logic and database operations
├── utils/        # Helper functions and formatters
├── config.ts     # Configuration settings
├── client.ts     # Test client for local testing
└── index.ts      # Main entry point with MCP tool definitions
```

## Learning from This Project

This project is designed as an educational resource. To get the most out of it:

1. Read the [GUIDE.md](GUIDE.md) for a comprehensive explanation of the design
2. Study the heavily commented source code to understand implementation details
3. Use the test client to see how the server works in practice
4. Experiment with adding your own tools or extending the existing ones

## Development

### Building

```bash
npm run build
```

### Running in Development Mode

```bash
npm run dev
```

## License

MIT