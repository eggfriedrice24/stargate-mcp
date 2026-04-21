import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";

async function asanaRequest(
  endpoint: string,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: Record<string, unknown>
): Promise<unknown> {
  const token = process.env.ASANA_TOKEN;
  if (!token) {
    throw new Error("ASANA_TOKEN environment variable not set");
  }

  const response = await fetch(`${ASANA_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify({ data: body }) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Asana API error (${response.status}): ${error}`);
  }

  const json = await response.json();
  return json.data;
}

export function registerAsanaTools(server: McpServer) {
  // List projects in workspace
  server.tool(
    "asana_list_projects",
    "List all projects in your Asana workspace",
    {
      workspace_gid: z.string().describe("Workspace GID (run asana_list_workspaces to find it)"),
    },
    async ({ workspace_gid }) => {
      try {
        const projects = await asanaRequest(
          `/workspaces/${workspace_gid}/projects?opt_fields=name,gid,current_status`
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(projects, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // List workspaces
  server.tool(
    "asana_list_workspaces",
    "List all Asana workspaces you have access to",
    {},
    async () => {
      try {
        const workspaces = await asanaRequest("/workspaces");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(workspaces, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // List sections (columns) in a project
  server.tool(
    "asana_list_sections",
    "List all sections (columns) in an Asana project",
    {
      project_gid: z.string().describe("Project GID"),
    },
    async ({ project_gid }) => {
      try {
        const sections = await asanaRequest(`/projects/${project_gid}/sections`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(sections, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // List tasks in a project or section
  server.tool(
    "asana_list_tasks",
    "List tasks in an Asana project or section",
    {
      project_gid: z.string().optional().describe("Project GID (list all tasks in project)"),
      section_gid: z.string().optional().describe("Section GID (list tasks in specific column)"),
    },
    async ({ project_gid, section_gid }) => {
      try {
        let endpoint: string;
        const fields = "opt_fields=name,gid,completed,assignee.name,due_on,custom_fields";

        if (section_gid) {
          endpoint = `/sections/${section_gid}/tasks?${fields}`;
        } else if (project_gid) {
          endpoint = `/projects/${project_gid}/tasks?${fields}`;
        } else {
          throw new Error("Either project_gid or section_gid is required");
        }

        const tasks = await asanaRequest(endpoint);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Get task details
  server.tool(
    "asana_get_task",
    "Get detailed information about a specific Asana task",
    {
      task_gid: z.string().describe("Task GID"),
    },
    async ({ task_gid }) => {
      try {
        const task = await asanaRequest(
          `/tasks/${task_gid}?opt_fields=name,notes,completed,assignee.name,due_on,custom_fields,memberships.section.name`
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Create a task in a project
  server.tool(
    "asana_create_task",
    "Create a new task in an Asana project, optionally in a specific section",
    {
      project_gid: z.string().describe("Project GID to add the task to"),
      section_gid: z.string().optional().describe("Section GID to place the task in"),
      name: z.string().describe("Task name"),
      notes: z.string().optional().describe("Task description/notes"),
      due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
      assignee: z.string().optional().describe("Assignee GID"),
    },
    async ({ project_gid, section_gid, name, notes, due_on, assignee }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          projects: [project_gid],
        };
        if (notes !== undefined) body.notes = notes;
        if (due_on !== undefined) body.due_on = due_on;
        if (assignee !== undefined) body.assignee = assignee;

        const task = await asanaRequest("/tasks", "POST", body) as { gid: string };

        if (section_gid) {
          await asanaRequest(`/sections/${section_gid}/addTask`, "POST", {
            task: task.gid,
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Task created:\n${JSON.stringify(task, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Create a subtask under a parent task
  server.tool(
    "asana_create_subtask",
    "Create a subtask under a parent Asana task",
    {
      parent_task_gid: z.string().describe("Parent task GID"),
      name: z.string().describe("Subtask name"),
      notes: z.string().optional().describe("Subtask description/notes"),
      due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
      assignee: z.string().optional().describe("Assignee GID"),
    },
    async ({ parent_task_gid, name, notes, due_on, assignee }) => {
      try {
        const body: Record<string, unknown> = { name };
        if (notes !== undefined) body.notes = notes;
        if (due_on !== undefined) body.due_on = due_on;
        if (assignee !== undefined) body.assignee = assignee;

        const subtask = await asanaRequest(
          `/tasks/${parent_task_gid}/subtasks`,
          "POST",
          body
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Subtask created:\n${JSON.stringify(subtask, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Update custom fields (for estimated/actual time)
  server.tool(
    "asana_update_custom_fields",
    "Update custom fields on an Asana task (use for estimated/actual time)",
    {
      task_gid: z.string().describe("Task GID"),
      custom_fields: z
        .string()
        .describe('JSON string mapping custom field GID to value, e.g. \'{"123456": 5, "789012": 3}\''),
    },
    async ({ task_gid, custom_fields }) => {
      try {
        const parsed = JSON.parse(custom_fields);
        const task = await asanaRequest(`/tasks/${task_gid}`, "PUT", {
          custom_fields: parsed,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated task custom fields:\n${JSON.stringify(task, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Move task to a different section (column)
  server.tool(
    "asana_move_task",
    "Move a task to a different section (column) in Asana",
    {
      task_gid: z.string().describe("Task GID"),
      section_gid: z.string().describe("Target section GID to move the task to"),
    },
    async ({ task_gid, section_gid }) => {
      try {
        await asanaRequest(`/sections/${section_gid}/addTask`, "POST", {
          task: task_gid,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Task ${task_gid} moved to section ${section_gid}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Update task (name, notes, due date, completed)
  server.tool(
    "asana_update_task",
    "Update basic task properties (name, notes, due date, completion status)",
    {
      task_gid: z.string().describe("Task GID"),
      name: z.string().optional().describe("New task name"),
      notes: z.string().optional().describe("New task description/notes"),
      due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
      completed: z.boolean().optional().describe("Mark task as completed or not"),
    },
    async ({ task_gid, name, notes, due_on, completed }) => {
      try {
        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name;
        if (notes !== undefined) updates.notes = notes;
        if (due_on !== undefined) updates.due_on = due_on;
        if (completed !== undefined) updates.completed = completed;

        const task = await asanaRequest(`/tasks/${task_gid}`, "PUT", updates);
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated task:\n${JSON.stringify(task, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // List subtasks of a task
  server.tool(
    "asana_list_subtasks",
    "List all subtasks (children) of an Asana task",
    {
      task_gid: z.string().describe("Parent task GID"),
    },
    async ({ task_gid }) => {
      try {
        const subtasks = await asanaRequest(
          `/tasks/${task_gid}/subtasks?opt_fields=name,gid,completed,assignee.name,due_on,custom_fields`
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(subtasks, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Add comment to task
  server.tool(
    "asana_add_comment",
    "Add a comment to an Asana task",
    {
      task_gid: z.string().describe("Task GID"),
      text: z.string().describe("Comment text"),
    },
    async ({ task_gid, text }) => {
      try {
        const story = await asanaRequest(`/tasks/${task_gid}/stories`, "POST", {
          text,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Comment added:\n${JSON.stringify(story, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );
}
