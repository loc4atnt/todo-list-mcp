/**
 * index.ts
 * 
 * This is the main entry point for the Todo MCP server.
 * It defines all the tools provided by the server and handles
 * connecting to clients.
 * 
 * WHAT IS MCP?
 * The Model Context Protocol (MCP) allows AI models like Claude
 * to interact with external tools and services. This server implements
 * the MCP specification to provide a Todo list functionality that
 * Claude can use.
 * 
 * HOW THE SERVER WORKS:
 * 1. It creates an MCP server instance with identity information
 * 2. It defines a set of tools for managing todos
 * 3. It connects to a transport (HTTP SSE in this configuration)
 * 4. It handles incoming tool calls from clients (like Claude)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";

// Import models and schemas
import {
  CreateTodoSchema,
  UpdateTodoSchema,
  CompleteTodoSchema,
  DeleteTodoSchema,
  SearchTodosByTitleSchema,
  SearchTodosByDateSchema
} from "./models/Todo.js";

// Import services
import { todoService } from "./services/TodoService.js";
import { databaseService } from "./services/DatabaseService.js";

// Import utilities
import { createSuccessResponse, createErrorResponse, formatTodo, formatTodoList } from "./utils/formatters.js";
import { config } from "./config.js";

/**
 * Create the MCP server
 * 
 * We initialize with identity information that helps clients
 * understand what they're connecting to.
 */
const server = new McpServer({
  name: "Todo-MCP-Server",
  version: "1.0.0",
});

let activeTransport: SSEServerTransport | null = null;
let httpServer: HttpServer | null = null;
let shuttingDown = false;

/**
 * Helper function to safely execute operations
 * 
 * This function:
 * 1. Attempts to execute an operation
 * 2. Catches any errors
 * 3. Returns either the result or an Error object
 * 
 * WHY USE THIS PATTERN?
 * - Centralizes error handling
 * - Prevents crashes from uncaught exceptions
 * - Makes error reporting consistent across all tools
 * - Simplifies the tool implementations
 * 
 * @param operation The function to execute
 * @param errorMessage The message to include if an error occurs
 * @returns Either the operation result or an Error
 */
async function safeExecute<T>(operation: () => T, errorMessage: string) {
  try {
    const result = operation();
    return result;
  } catch (error) {
    console.error(errorMessage, error);
    if (error instanceof Error) {
      return new Error(`${errorMessage}: ${error.message}`);
    }
    return new Error(errorMessage);
  }
}

function getAuthorizationHeader(req: IncomingMessage) {
  const header = req.headers["authorization"];
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

function isRequestAuthorized(req: IncomingMessage, res: ServerResponse) {
  if (!config.http.requiresAuth) {
    return true;
  }

  const expected = config.http.expectedAuthHeader;
  const provided = getAuthorizationHeader(req);

  if (!expected) {
    return true;
  }

  if (provided === expected) {
    return true;
  }

  console.error("Rejected unauthorized request");
  if (!res.headersSent) {
    res.writeHead(401, {
      "Content-Type": "text/plain",
      "WWW-Authenticate": `${config.http.authScheme} realm="Todo MCP Server"`,
    });
  }
  res.end("Unauthorized");
  return false;
}

async function handleSseRequest(req: IncomingMessage, res: ServerResponse) {
  console.error("Received SSE connection request");

  if (shuttingDown) {
    res.writeHead(503).end("Server is shutting down");
    return;
  }

  if (!isRequestAuthorized(req, res)) {
    return;
  }

  const existingTransport = activeTransport;
  if (existingTransport) {
    console.error("Closing existing SSE session before accepting new connection");
    try {
      await existingTransport.close();
    } catch (error) {
      console.error("Error while closing existing SSE session:", error);
    }

    activeTransport = null;

    try {
      await server.close();
    } catch (error) {
      console.error("Error while closing previous MCP transport:", error);
    }
  }

  const transport = new SSEServerTransport(config.http.messagesPath, res);
  activeTransport = transport;

  res.on("close", () => {
    if (activeTransport === transport) {
      activeTransport = null;
    }
  });

  try {
    await server.connect(transport);
    console.error(`SSE connection established (sessionId=${transport.sessionId})`);
    console.error(
      `Send MCP messages via POST ${config.http.messagesPath}?sessionId=${transport.sessionId}`
    );
  } catch (error) {
    console.error("Failed to establish SSE connection:", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    } else {
      res.end();
    }

    if (activeTransport === transport) {
      activeTransport = null;
    }
  }
}

async function handleMessagesRequest(req: IncomingMessage, res: ServerResponse) {
  if (!isRequestAuthorized(req, res)) {
    return;
  }

  if (!activeTransport) {
    res.writeHead(503).end("No active SSE session");
    return;
  }

  try {
    await activeTransport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to handle MCP message:", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to handle MCP message");
    }
  }
}

/**
 * Tool 1: Create a new todo
 * 
 * This tool:
 * 1. Validates the input (title and description)
 * 2. Creates a new todo using the service
 * 3. Returns the formatted todo
 * 
 * PATTERN FOR ALL TOOLS:
 * - Register with server.tool()
 * - Define name, description, and parameter schema
 * - Implement the async handler function
 * - Use safeExecute for error handling
 * - Return properly formatted response
 */
server.tool(
  "create-todo",
  "Create a new todo item",
  {
    title: z.string().min(1, "Title is required"),
    description: z.string().min(1, "Description is required"),
  },
  async ({ title, description }) => {
    const result = await safeExecute(() => {
      const validatedData = CreateTodoSchema.parse({ title, description });
      const newTodo = todoService.createTodo(validatedData);
      return formatTodo(newTodo);
    }, "Failed to create todo");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(`✅ Todo Created:\n\n${result}`);
  }
);

/**
 * Tool 2: List all todos
 * 
 * This tool:
 * 1. Retrieves all todos from the service
 * 2. Formats them as a list
 * 3. Returns the formatted list
 */
server.tool(
  "list-todos",
  "List all todos",
  {},
  async () => {
    const result = await safeExecute(() => {
      const todos = todoService.getAllTodos();
      return formatTodoList(todos);
    }, "Failed to list todos");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(result);
  }
);

/**
 * Tool 3: Get a specific todo by ID
 * 
 * This tool:
 * 1. Validates the input ID
 * 2. Retrieves the specific todo
 * 3. Returns the formatted todo
 */
server.tool(
  "get-todo",
  "Get a specific todo by ID",
  {
    id: z.string().uuid("Invalid Todo ID"),
  },
  async ({ id }) => {
    const result = await safeExecute(() => {
      const todo = todoService.getTodo(id);
      if (!todo) {
        throw new Error(`Todo with ID ${id} not found`);
      }
      return formatTodo(todo);
    }, "Failed to get todo");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(result);
  }
);

/**
 * Tool 4: Update a todo
 * 
 * This tool:
 * 1. Validates the input (id required, title/description optional)
 * 2. Ensures at least one field is being updated
 * 3. Updates the todo using the service
 * 4. Returns the formatted updated todo
 */
server.tool(
  "update-todo",
  "Update a todo title or description",
  {
    id: z.string().uuid("Invalid Todo ID"),
    title: z.string().min(1, "Title is required").optional(),
    description: z.string().min(1, "Description is required").optional(),
  },
  async ({ id, title, description }) => {
    const result = await safeExecute(() => {
      const validatedData = UpdateTodoSchema.parse({ id, title, description });
      
      // Ensure at least one field is being updated
      if (!title && !description) {
        throw new Error("At least one field (title or description) must be provided");
      }

      const updatedTodo = todoService.updateTodo(validatedData);
      if (!updatedTodo) {
        throw new Error(`Todo with ID ${id} not found`);
      }

      return formatTodo(updatedTodo);
    }, "Failed to update todo");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(`✅ Todo Updated:\n\n${result}`);
  }
);

/**
 * Tool 5: Complete a todo
 * 
 * This tool:
 * 1. Validates the todo ID
 * 2. Marks the todo as completed using the service
 * 3. Returns the formatted completed todo
 * 
 * WHY SEPARATE FROM UPDATE?
 * - Provides a dedicated semantic action for completion
 * - Simplifies the client interaction model
 * - It's easier for the LLM to match the user intent with the completion action
 * - Makes it clear in the UI that the todo is done
 */
server.tool(
  "complete-todo",
  "Mark a todo as completed",
  {
    id: z.string().uuid("Invalid Todo ID"),
  },
  async ({ id }) => {
    const result = await safeExecute(() => {
      const validatedData = CompleteTodoSchema.parse({ id });
      const completedTodo = todoService.completeTodo(validatedData.id);
      
      if (!completedTodo) {
        throw new Error(`Todo with ID ${id} not found`);
      }

      return formatTodo(completedTodo);
    }, "Failed to complete todo");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(`✅ Todo Completed:\n\n${result}`);
  }
);

/**
 * Tool 6: Delete a todo
 * 
 * This tool:
 * 1. Validates the todo ID
 * 2. Retrieves the todo to be deleted (for the response)
 * 3. Deletes the todo using the service
 * 4. Returns a success message with the deleted todo's title
 */
server.tool(
  "delete-todo",
  "Delete a todo",
  {
    id: z.string().uuid("Invalid Todo ID"),
  },
  async ({ id }) => {
    const result = await safeExecute(() => {
      const validatedData = DeleteTodoSchema.parse({ id });
      const todo = todoService.getTodo(validatedData.id);
      
      if (!todo) {
        throw new Error(`Todo with ID ${id} not found`);
      }
      
      const success = todoService.deleteTodo(validatedData.id);
      
      if (!success) {
        throw new Error(`Failed to delete todo with ID ${id}`);
      }
      
      return todo.title;
    }, "Failed to delete todo");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(`✅ Todo Deleted: "${result}"`);
  }
);

/**
 * Tool 7: Search todos by title
 * 
 * This tool:
 * 1. Validates the search term
 * 2. Searches todos by title using the service
 * 3. Returns a formatted list of matching todos
 * 
 * WHY HAVE SEARCH?
 * - Makes it easy to find specific todos when the list grows large
 * - Allows partial matching without requiring exact title
 * - Case-insensitive for better user experience
 */
server.tool(
  "search-todos-by-title",
  "Search todos by title (case insensitive partial match)",
  {
    title: z.string().min(1, "Search term is required"),
  },
  async ({ title }) => {
    const result = await safeExecute(() => {
      const validatedData = SearchTodosByTitleSchema.parse({ title });
      const todos = todoService.searchByTitle(validatedData.title);
      return formatTodoList(todos);
    }, "Failed to search todos");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(result);
  }
);

/**
 * Tool 8: Search todos by date
 * 
 * This tool:
 * 1. Validates the date format (YYYY-MM-DD)
 * 2. Searches todos created on that date
 * 3. Returns a formatted list of matching todos
 * 
 * WHY DATE SEARCH?
 * - Allows finding todos created on a specific day
 * - Useful for reviewing what was added on a particular date
 * - Complements title search for different search needs
 */
server.tool(
  "search-todos-by-date",
  "Search todos by creation date (format: YYYY-MM-DD)",
  {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  },
  async ({ date }) => {
    const result = await safeExecute(() => {
      const validatedData = SearchTodosByDateSchema.parse({ date });
      const todos = todoService.searchByDate(validatedData.date);
      return formatTodoList(todos);
    }, "Failed to search todos by date");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(result);
  }
);

/**
 * Tool 9: List active todos
 * 
 * This tool:
 * 1. Retrieves all non-completed todos
 * 2. Returns a formatted list of active todos
 * 
 * WHY SEPARATE FROM LIST ALL?
 * - Active todos are typically what users most often want to see
 * - Reduces noise by filtering out completed items
 * - Provides a clearer view of outstanding work
 */
server.tool(
  "list-active-todos",
  "List all non-completed todos",
  {},
  async () => {
    const result = await safeExecute(() => {
      const todos = todoService.getActiveTodos();
      return formatTodoList(todos);
    }, "Failed to list active todos");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(result);
  }
);

/**
 * Tool 10: Summarize active todos
 * 
 * This tool:
 * 1. Generates a summary of all active todos
 * 2. Returns a formatted markdown summary
 * 
 * WHY HAVE A SUMMARY?
 * - Provides a quick overview without details
 * - Perfect for a quick status check
 * - Easier to read than a full list when there are many todos
 * - Particularly useful for LLM interfaces where conciseness matters
 */
server.tool(
  "summarize-active-todos",
  "Generate a summary of all active (non-completed) todos",
  {},
  async () => {
    const result = await safeExecute(() => {
      return todoService.summarizeActiveTodos();
    }, "Failed to summarize active todos");

    if (result instanceof Error) {
      return createErrorResponse(result.message);
    }

    return createSuccessResponse(result);
  }
);

/**
 * Main function to start the server
 * 
 * This function:
 * 1. Initializes the server
 * 2. Sets up graceful shutdown handlers
 * 3. Starts an HTTP server that exposes the SSE transport
 * 
 * WHY USE HTTP SSE TRANSPORT?
 * - Enables remote clients to connect over HTTP
 * - Keeps a streaming channel open for MCP traffic
 * - Matches the MCP SDK's built-in HTTP streaming support
 */
async function main() {
  console.error("Starting Todo MCP Server...");
  console.error(`SQLite database path: ${config.db.path}`);
  console.error(`HTTP base URL: ${config.http.baseUrl}`);

  try {
    httpServer = createServer((req, res) => {
      void (async () => {
        if (!req.url) {
          res.writeHead(400).end("Bad Request");
          return;
        }

        const requestUrl = new URL(req.url, config.http.baseUrl);

        if (req.method === "GET" && requestUrl.pathname === config.http.ssePath) {
          await handleSseRequest(req, res);
          return;
        }

        if (req.method === "POST" && requestUrl.pathname === config.http.messagesPath) {
          await handleMessagesRequest(req, res);
          return;
        }

        res.writeHead(404).end("Not Found");
      })().catch((error) => {
        console.error("Unhandled error while processing request:", error);
        if (!res.headersSent) {
          res.writeHead(500).end("Internal Server Error");
        } else {
          res.end();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      if (!httpServer) {
        reject(new Error("HTTP server not initialized"));
        return;
      }

      const onError = (error: Error) => {
        httpServer?.off("error", onError);
        reject(error);
      };

      httpServer.once("error", onError);
      httpServer.listen(config.http.port, config.http.host, () => {
        httpServer?.off("error", onError);
        resolve();
      });
    });

    console.error("Todo MCP Server running on HTTP SSE transport");
    console.error(`SSE endpoint: ${config.http.sseUrl}`);
    console.error(`Message endpoint: ${config.http.messagesUrl}`);
  } catch (error) {
    console.error("Failed to start Todo MCP Server:", error);
    databaseService.close();

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer?.close(() => resolve());
      });
    }

    process.exit(1);
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(`Received ${signal}. Shutting down...`);

    if (activeTransport) {
      try {
        await activeTransport.close();
      } catch (error) {
        console.error("Error closing SSE transport during shutdown:", error);
      } finally {
        activeTransport = null;
      }
    }

    try {
      await server.close();
    } catch (error) {
      console.error("Error closing MCP server during shutdown:", error);
    }

    await new Promise<void>((resolve) => {
      if (!httpServer) {
        resolve();
        return;
      }

      httpServer.close((closeError) => {
        if (closeError) {
          console.error("Error closing HTTP server:", closeError);
        }
        resolve();
      });
    });

    databaseService.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// Start the server
main(); 