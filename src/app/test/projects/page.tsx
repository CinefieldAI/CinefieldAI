"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useClerkSupabaseClient } from "@/lib/supabase/useClerkSupabaseClient";
import { useUser } from "@clerk/nextjs";
import { Project, ProjectInsertPayload, ProjectUpdatePayload } from "@/types/database";
import { Trash2, Edit2, X } from "lucide-react";

/**
 * Temporary Projects CRUD test page.
 * Verifies full CRUD functionality through authenticated Supabase client and RLS policies.
 *
 * Access: http://localhost:3000/test/projects (while signed in)
 * Remove this page before production.
 */
export default function ProjectsTestPage() {
  const { user, isLoaded: userLoaded } = useUser();
  const { supabase, isLoaded: supabaseLoaded, isSignedIn } = useClerkSupabaseClient();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // Delete confirmation state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // RLS test state
  const [rlsTestRunning, setRlsTestRunning] = useState(false);
  const [rlsTestResult, setRlsTestResult] = useState<string | null>(null);

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    if (!isSignedIn || !supabase) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (queryError) {
        setError(`Failed to fetch projects: ${queryError.message}`);
        setProjects([]);
        return;
      }

      setProjects((data as Project[]) || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch projects"
      );
      setProjects([]);
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn, supabase]);

  // Fetch projects on mount and when auth state changes
  useEffect(() => {
    if (userLoaded && supabaseLoaded && isSignedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchProjects();
    }
  }, [userLoaded, supabaseLoaded, isSignedIn, fetchProjects]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timeout = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timeout);
    }
  }, [successMessage]);

  // Validate form input
  const validateForm = (t: string, d: string): string | null => {
    const trimmedTitle = t.trim();
    if (!trimmedTitle) return "Title is required";
    if (trimmedTitle.length < 1 || trimmedTitle.length > 150)
      return "Title must be between 1 and 150 characters";
    if (d && d.length > 2000)
      return "Description must be maximum 2000 characters";
    return null;
  };

  // Handle create project
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || isSubmitting) return;

    const validationError = validateForm(title, description);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    // Prevent duplicate submissions
    if (submitTimeoutRef.current) {
      clearTimeout(submitTimeoutRef.current);
    }

    try {
      const payload: ProjectInsertPayload = {
        title: title.trim(),
        description: description.trim() || null,
      };

      const { data, error: insertError } = await supabase
        .from("projects")
        .insert([payload])
        .select()
        .single();

      if (insertError) {
        setError(`Failed to create project: ${insertError.message}`);
        return;
      }

      setSuccessMessage("Project created successfully!");
      setTitle("");
      setDescription("");
      setProjects([data as Project, ...projects]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create project"
      );
    } finally {
      setIsSubmitting(false);
      submitTimeoutRef.current = setTimeout(() => {
        setIsSubmitting(false);
      }, 1000);
    }
  };

  // Handle update project
  const handleUpdateProject = async (projectId: string) => {
    if (!supabase || isEditing) return;

    const validationError = validateForm(editTitle, editDescription);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsEditing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const payload: ProjectUpdatePayload = {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
      };

      const { data, error: updateError } = await supabase
        .from("projects")
        .update(payload)
        .eq("id", projectId)
        .select()
        .single();

      if (updateError) {
        setError(`Failed to update project: ${updateError.message}`);
        return;
      }

      setSuccessMessage("Project updated successfully!");
      setEditingId(null);
      setProjects(
        projects.map((p) => (p.id === projectId ? (data as Project) : p))
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update project"
      );
    } finally {
      setIsEditing(false);
    }
  };

  // Handle delete project
  const handleDeleteProject = async (projectId: string) => {
    if (!supabase || isDeleting) return;

    setIsDeleting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { error: deleteError } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId);

      if (deleteError) {
        setError(`Failed to delete project: ${deleteError.message}`);
        return;
      }

      setSuccessMessage("Project deleted successfully!");
      setProjects(projects.filter((p) => p.id !== projectId));
      setDeleteConfirmId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete project"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // RLS negative test
  const handleRlsTest = async () => {
    if (!supabase || !user) return;

    setRlsTestRunning(true);
    setRlsTestResult(null);

    try {
      // Attempt to insert a row with a deliberately invalid clerk_user_id
      const invalidClerkId = "invalid_user_id_" + Date.now();

      const { error } = await supabase
        .from("projects")
        .insert([
          {
            clerk_user_id: invalidClerkId,
            title: "RLS Test - Should Fail",
            description: null,
          },
        ]);

      if (error) {
        // Expected: RLS should reject this
        setRlsTestResult("✓ RLS ownership protection: passed");
        if (process.env.NODE_ENV === "development") {
          console.debug("[RLS Test] Correctly rejected invalid owner:", error.message);
        }
      } else {
        setRlsTestResult("✗ RLS ownership protection: failed (row was inserted)");
      }
    } catch (err) {
      // Unexpected error
      setRlsTestResult("✗ RLS test error: " + (err instanceof Error ? err.message : "Unknown"));
    } finally {
      setRlsTestRunning(false);
    }
  };

  // If user not loaded or Clerk is still loading
  if (!userLoaded || !supabaseLoaded) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Projects CRUD Test</h1>
          <p className="text-zinc-400">Loading...</p>
        </div>
      </div>
    );
  }

  // If signed out
  if (!isSignedIn || !user) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Projects CRUD Test</h1>
          <div className="bg-zinc-900 rounded-lg p-6 mb-6">
            <p className="text-amber-400 mb-4">⚠️ Sign in required to access this test page.</p>
            <Link
              href="/"
              className="inline-block px-4 py-2 bg-[#D97757] hover:bg-[#c9684a] text-white rounded-lg transition-colors"
            >
              Return to Home
            </Link>
          </div>
          <p className="text-xs text-zinc-500">
            Temporary development page. Remove before production.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Projects CRUD Test</h1>
          <p className="text-xs text-zinc-500">
            Temporary development page. Remove before production.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-900/20 border border-red-500/30 rounded-lg p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="mb-6 bg-green-900/20 border border-green-500/30 rounded-lg p-4">
            <p className="text-green-400 text-sm">{successMessage}</p>
          </div>
        )}

        {/* Create Project Form */}
        <div className="bg-zinc-900 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Create Project</h2>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-200 mb-2">
                Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter project title"
                disabled={isSubmitting}
                maxLength={150}
                className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-lg focus:border-[#D97757] focus:outline-none disabled:opacity-50"
              />
              <p className="text-xs text-zinc-500 mt-1">
                {title.length} / 150 characters
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-200 mb-2">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter project description"
                disabled={isSubmitting}
                maxLength={2000}
                rows={4}
                className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-lg focus:border-[#D97757] focus:outline-none disabled:opacity-50 resize-none"
              />
              <p className="text-xs text-zinc-500 mt-1">
                {description.length} / 2000 characters
              </p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#D97757] hover:bg-[#c9684a] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Creating..." : "Create Project"}
            </button>
          </form>
        </div>

        {/* Projects List */}
        <div className="bg-zinc-900 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">
            Projects {isLoading && "...loading"}
          </h2>

          {isLoading && (
            <p className="text-zinc-400">Loading projects...</p>
          )}

          {!isLoading && projects.length === 0 && (
            <p className="text-zinc-400">No projects yet. Create one to get started.</p>
          )}

          {!isLoading && projects.length > 0 && (
            <div className="space-y-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="border border-zinc-700 rounded-lg p-4 bg-zinc-800/50"
                >
                  {editingId === project.id ? (
                    // Edit mode
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        maxLength={150}
                        className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 text-white rounded focus:border-[#D97757] focus:outline-none"
                      />
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        maxLength={2000}
                        rows={3}
                        className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 text-white rounded focus:border-[#D97757] focus:outline-none resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            handleUpdateProject(project.id)
                          }
                          disabled={isEditing}
                          className="px-3 py-1 bg-[#D97757] hover:bg-[#c9684a] text-white text-sm rounded transition-colors disabled:opacity-50"
                        >
                          {isEditing ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          disabled={isEditing}
                          className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <>
                      <div className="mb-2">
                        <p className="text-lg font-semibold text-white">
                          {project.title}
                        </p>
                        {project.description && (
                          <p className="text-sm text-zinc-300 mt-1">
                            {project.description}
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2 text-xs text-zinc-400 mb-3">
                        <span>Status: {project.status}</span>
                        <span>•</span>
                        <span>
                          Created: {new Date(project.created_at).toLocaleDateString()}
                        </span>
                        <span>•</span>
                        <span>
                          Updated: {new Date(project.updated_at).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingId(project.id);
                            setEditTitle(project.title);
                            setEditDescription(project.description || "");
                          }}
                          className="flex items-center gap-1 px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded transition-colors"
                        >
                          <Edit2 size={14} />
                          Edit
                        </button>

                        {deleteConfirmId === project.id ? (
                          <>
                            <span className="text-xs text-red-400">
                              Delete?
                            </span>
                            <button
                              onClick={() =>
                                handleDeleteProject(project.id)
                              }
                              disabled={isDeleting}
                              className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors disabled:opacity-50"
                            >
                              {isDeleting ? "..." : "Confirm"}
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              disabled={isDeleting}
                              className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-xs rounded"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(project.id)}
                            className="flex items-center gap-1 px-3 py-1 bg-zinc-700 hover:bg-red-900/30 text-red-400 text-sm rounded transition-colors"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RLS Test */}
        <div className="bg-zinc-900 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">RLS Security Test</h2>
          <p className="text-sm text-zinc-300 mb-4">
            Test that RLS policies correctly reject operations with mismatched owner.
          </p>
          <button
            onClick={handleRlsTest}
            disabled={rlsTestRunning}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {rlsTestRunning ? "Running..." : "Test RLS Ownership Protection"}
          </button>
          {rlsTestResult && (
            <p
              className={`text-sm mt-3 ${
                rlsTestResult.startsWith("✓")
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {rlsTestResult}
            </p>
          )}
        </div>

        {/* Footer */}
        <p className="text-xs text-zinc-500 text-center">
          Development test page only. Remove /src/app/test/projects before production.
        </p>
      </div>
    </div>
  );
}
