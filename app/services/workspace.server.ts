// Workspace service for managing workspaces and memberships
import db from "../db.server";
import type { Workspace, WorkspaceMember, MemberRole } from "@prisma/client";

export interface CreateWorkspaceData {
  name: string;
  slug: string;
  ownerId: string;
}

/**
 * Create a new workspace
 */
export async function createWorkspace(data: CreateWorkspaceData): Promise<Workspace> {
  // Check if slug is already taken
  const existing = await db.workspace.findUnique({
    where: { slug: data.slug },
  });

  if (existing) {
    throw new Error("Workspace with this slug already exists");
  }

  // Create workspace
  const workspace = await db.workspace.create({
    data: {
      name: data.name,
      slug: data.slug,
      ownerId: data.ownerId,
    },
  });

  // Add owner as a member
  await db.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: data.ownerId,
      role: "OWNER",
    },
  });

  return workspace;
}

/**
 * Get workspace by ID
 */
export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  return db.workspace.findUnique({
    where: { id },
    include: {
      owner: true,
      members: {
        include: {
          user: true,
        },
      },
    },
  });
}

/**
 * Get workspace by slug
 */
export async function getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
  return db.workspace.findUnique({
    where: { slug },
    include: {
      owner: true,
      members: {
        include: {
          user: true,
        },
      },
    },
  });
}

/**
 * Get user's workspaces
 */
export async function getUserWorkspaces(userId: string): Promise<Workspace[]> {
  const memberships = await db.workspaceMember.findMany({
    where: { userId },
    include: {
      workspace: {
        include: {
          owner: true,
        },
      },
    },
  });

  return memberships.map((m) => m.workspace);
}

/**
 * Add member to workspace
 */
export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: MemberRole = "MEMBER"
): Promise<WorkspaceMember> {
  // Check if already a member
  const existing = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
  });

  if (existing) {
    throw new Error("User is already a member of this workspace");
  }

  return db.workspaceMember.create({
    data: {
      workspaceId,
      userId,
      role,
    },
  });
}

/**
 * Update member role
 */
export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: MemberRole
): Promise<WorkspaceMember> {
  return db.workspaceMember.update({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    data: { role },
  });
}

/**
 * Remove member from workspace
 */
export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  await db.workspaceMember.delete({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
  });
}

/**
 * Check if user has access to workspace
 */
export async function hasWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const member = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
  });

  return !!member;
}

/**
 * Check if user has specific role in workspace
 */
export async function hasWorkspaceRole(
  workspaceId: string,
  userId: string,
  requiredRole: MemberRole
): Promise<boolean> {
  const member = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
  });

  if (!member) return false;

  // Role hierarchy: OWNER > ADMIN > MEMBER > VIEWER
  const roleHierarchy: Record<MemberRole, number> = {
    OWNER: 4,
    ADMIN: 3,
    MEMBER: 2,
    VIEWER: 1,
  };

  const memberRoleLevel = roleHierarchy[member.role as MemberRole];
  const requiredRoleLevel = roleHierarchy[requiredRole];
  
  return memberRoleLevel >= requiredRoleLevel;
}

/**
 * Update workspace
 */
export async function updateWorkspace(
  id: string,
  data: Partial<Workspace>
): Promise<Workspace> {
  return db.workspace.update({
    where: { id },
    data,
  });
}

/**
 * Delete workspace
 */
export async function deleteWorkspace(id: string): Promise<void> {
  await db.workspace.delete({
    where: { id },
  });
}
