"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useClerkSupabaseClient } from "@/lib/supabase/useClerkSupabaseClient";
import { useUser } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { useAuthModal } from "@/context/AuthModalContext";
import { Generation, GenerationInsertPayload, Project } from "@/types/database";
import { Upload, Trash2, X } from "lucide-react";

type GenerationType = "image" | "video" | "audio";
type TestStatus = "PASS" | "FAIL" | "NOT RUN";

interface TestResults {
  authRequest: TestStatus;
  projectsLoading: TestStatus;
  generationInsert: TestStatus;
  generationSelect: TestStatus;
  inputUpload: TestStatus;
  inputListing: TestStatus;
  inputDeletion: TestStatus;
  wrongUserFolderRls: TestStatus;
  outputBrowserUploadBlocked: TestStatus;
  outputListing: TestStatus;
}

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export default function GenerationsStorageTestPage() {
  const { user, isLoaded: userLoaded } = useUser();
  const { supabase, isLoaded: supabaseLoaded, isSignedIn } = useClerkSupabaseClient();
  const { openModal } = useAuthModal();
  useAuth();

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Projects
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Generation form
  const [generationType, setGenerationType] = useState<GenerationType>("image");
  const [provider, setProvider] = useState("test-provider");
  const [model, setModel] = useState("test-model");
  const [prompt, setPrompt] = useState("Test generation from CinefieldAI");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [generationSubmitting, setGenerationSubmitting] = useState(false);

  // Generations list
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [generationsLoading, setGenerationsLoading] = useState(false);

  // File upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Input files listing
  const [inputFiles, setInputFiles] = useState<{ name: string; path: string }[]>([]);
  const [inputFilesLoading, setInputFilesLoading] = useState(false);

  // Output files listing
  const [outputFiles, setOutputFiles] = useState<{ name: string; path: string }[]>([]);
  const [outputFilesLoading, setOutputFilesLoading] = useState(false);

  // Test results
  const [testResults, setTestResults] = useState<TestResults>({
    authRequest: "NOT RUN",
    projectsLoading: "NOT RUN",
    generationInsert: "NOT RUN",
    generationSelect: "NOT RUN",
    inputUpload: "NOT RUN",
    inputListing: "NOT RUN",
    inputDeletion: "NOT RUN",
    wrongUserFolderRls: "NOT RUN",
    outputBrowserUploadBlocked: "NOT RUN",
    outputListing: "NOT RUN",
  });

  const isLoaded = userLoaded && supabaseLoaded;

  // Auth test on mount
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (isSignedIn && supabase) {
      setTestResults((prev) => ({ ...prev, authRequest: "PASS" }));
    } else if (isLoaded && !isSignedIn) {
      setTestResults((prev) => ({ ...prev, authRequest: "FAIL" }));
    }
  }, [isSignedIn, supabase, isLoaded]);

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    if (!isSignedIn || !supabase) return;

    setProjectsLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (queryError) {
        setError(`Failed to fetch projects: ${queryError.message}`);
        setTestResults((prev) => ({ ...prev, projectsLoading: "FAIL" }));
        setProjects([]);
        return;
      }

      const projectsList = (data as Project[]) || [];
      setProjects(projectsList);
      setTestResults((prev) => ({ ...prev, projectsLoading: "PASS" }));

      if (projectsList.length > 0 && !selectedProjectId) {
        setSelectedProjectId(projectsList[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch projects");
      setTestResults((prev) => ({ ...prev, projectsLoading: "FAIL" }));
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, [isSignedIn, supabase, selectedProjectId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      fetchProjects();
    }
  }, [isLoaded, isSignedIn, fetchProjects]);

  // Fetch generations
  const fetchGenerations = useCallback(async () => {
    if (!isSignedIn || !supabase || !selectedProjectId) return;

    setGenerationsLoading(true);

    try {
      const { data, error: queryError } = await supabase
        .from("generations")
        .select("*")
        .eq("project_id", selectedProjectId)
        .order("created_at", { ascending: false });

      if (queryError) {
        setError(`Failed to fetch generations: ${queryError.message}`);
        setTestResults((prev) => ({ ...prev, generationSelect: "FAIL" }));
        setGenerations([]);
        return;
      }

      setGenerations((data as Generation[]) || []);
      setTestResults((prev) => ({ ...prev, generationSelect: "PASS" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch generations");
      setTestResults((prev) => ({ ...prev, generationSelect: "FAIL" }));
      setGenerations([]);
    } finally {
      setGenerationsLoading(false);
    }
  }, [isSignedIn, supabase, selectedProjectId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (selectedProjectId) {
      fetchGenerations();
    }
  }, [selectedProjectId, fetchGenerations]);

  // Create generation
  const handleCreateGeneration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !selectedProjectId || !user) return;

    setGenerationSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const payload: GenerationInsertPayload = {
        project_id: selectedProjectId,
        generation_type: generationType,
        provider,
        model,
        prompt,
        negative_prompt: negativePrompt || null,
        metadata: { test: true },
      };

      const { data, error: insertError } = await supabase
        .from("generations")
        .insert([payload])
        .select()
        .single();

      if (insertError) {
        setError(`Failed to create generation: ${insertError.message}`);
        setTestResults((prev) => ({ ...prev, generationInsert: "FAIL" }));
        return;
      }

      setSuccessMessage(`Generation created: ${data.id}`);
      setTestResults((prev) => ({ ...prev, generationInsert: "PASS" }));
      setPrompt("Test generation from CinefieldAI");
      setNegativePrompt("");
      await fetchGenerations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create generation");
      setTestResults((prev) => ({ ...prev, generationInsert: "FAIL" }));
    } finally {
      setGenerationSubmitting(false);
    }
  };

  // List input files
  const listInputFiles = useCallback(async () => {
    if (!supabase || !user || !selectedProjectId) return;

    setInputFilesLoading(true);

    try {
      const { data, error: listError } = await supabase.storage
        .from("generation-inputs")
        .list(`${user.id}/${selectedProjectId}`, {
          limit: 100,
          offset: 0,
          sortBy: { column: "created_at", order: "desc" },
        });

      if (listError) {
        setError(`Failed to list input files: ${listError.message}`);
        setTestResults((prev) => ({ ...prev, inputListing: "FAIL" }));
        setInputFiles([]);
        return;
      }

      const files = (data || [])
        .filter((item) => item.name !== ".emptyFolderPlaceholder")
        .map((item) => ({
          name: item.name,
          path: `${user.id}/${selectedProjectId}/${item.name}`,
        }));

      setInputFiles(files);
      setTestResults((prev) => ({ ...prev, inputListing: "PASS" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list input files");
      setTestResults((prev) => ({ ...prev, inputListing: "FAIL" }));
      setInputFiles([]);
    } finally {
      setInputFilesLoading(false);
    }
  }, [supabase, user, selectedProjectId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (selectedProjectId && user) {
      listInputFiles();
    }
  }, [selectedProjectId, user, listInputFiles]);

  // Upload file
  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !uploadFile || !user || !selectedProjectId) return;

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(uploadFile.type)) {
      setError(`File type not allowed: ${uploadFile.type}`);
      return;
    }

    // Validate size
    if (uploadFile.size > MAX_FILE_SIZE) {
      setError(`File size exceeds 50 MB limit`);
      return;
    }

    setUploading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Create collision-resistant filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 9);
      const ext = uploadFile.name.split(".").pop() || "bin";
      const filename = `${timestamp}-${random}.${ext}`;
      const path = `${user.id}/${selectedProjectId}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from("generation-inputs")
        .upload(path, uploadFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`);
        setTestResults((prev) => ({ ...prev, inputUpload: "FAIL" }));
        return;
      }

      setSuccessMessage(`File uploaded: ${filename}`);
      setTestResults((prev) => ({ ...prev, inputUpload: "PASS" }));
      setUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await listInputFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setTestResults((prev) => ({ ...prev, inputUpload: "FAIL" }));
    } finally {
      setUploading(false);
    }
  };

  // Delete input file
  const handleDeleteInputFile = async (path: string) => {
    if (!supabase) return;

    if (!confirm(`Delete ${path.split("/").pop()}?`)) return;

    setError(null);
    setSuccessMessage(null);

    try {
      const { error: deleteError } = await supabase.storage
        .from("generation-inputs")
        .remove([path]);

      if (deleteError) {
        setError(`Delete failed: ${deleteError.message}`);
        setTestResults((prev) => ({ ...prev, inputDeletion: "FAIL" }));
        return;
      }

      setSuccessMessage("File deleted");
      setTestResults((prev) => ({ ...prev, inputDeletion: "PASS" }));
      await listInputFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setTestResults((prev) => ({ ...prev, inputDeletion: "FAIL" }));
    }
  };

  // Test wrong-user folder RLS
  const testWrongUserFolderRls = async () => {
    if (!supabase || !selectedProjectId) return;

    setError(null);
    setSuccessMessage(null);

    try {
      // Create a tiny test image
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "red";
        ctx.fillRect(0, 0, 1, 1);
      }

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });

      const testPath = `another_user_security_test/${selectedProjectId}/blocked-test.png`;

      const { error: uploadError } = await supabase.storage
        .from("generation-inputs")
        .upload(testPath, blob);

      if (uploadError) {
        setSuccessMessage("✓ PASS: RLS blocked the wrong-user folder");
        setTestResults((prev) => ({ ...prev, wrongUserFolderRls: "PASS" }));
        return;
      }

      // If we get here, RLS failed - clean up
      await supabase.storage.from("generation-inputs").remove([testPath]);
      setError("✗ FAIL: security policy did not block the upload");
      setTestResults((prev) => ({ ...prev, wrongUserFolderRls: "FAIL" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "RLS test failed");
      setTestResults((prev) => ({ ...prev, wrongUserFolderRls: "FAIL" }));
    }
  };

  // Test blocked browser upload to generation-outputs
  const testBlockedOutputUpload = async () => {
    if (!supabase || !user || !selectedProjectId) return;

    setError(null);
    setSuccessMessage(null);

    try {
      // Create tiny test image
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "blue";
        ctx.fillRect(0, 0, 1, 1);
      }

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });

      const testPath = `${user.id}/${selectedProjectId}/blocked-output-test.png`;

      const { error: uploadError } = await supabase.storage
        .from("generation-outputs")
        .upload(testPath, blob);

      if (uploadError) {
        setSuccessMessage("✓ PASS: browser output upload was blocked");
        setTestResults((prev) => ({ ...prev, outputBrowserUploadBlocked: "PASS" }));
        return;
      }

      // If we get here, RLS failed - clean up
      await supabase.storage.from("generation-outputs").remove([testPath]);
      setError("✗ FAIL: browser was able to upload to generation-outputs");
      setTestResults((prev) => ({ ...prev, outputBrowserUploadBlocked: "FAIL" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Output upload test failed");
      setTestResults((prev) => ({ ...prev, outputBrowserUploadBlocked: "FAIL" }));
    }
  };

  // List output files
  const listOutputFiles = useCallback(async () => {
    if (!supabase || !user || !selectedProjectId) return;

    setOutputFilesLoading(true);

    try {
      const { data, error: listError } = await supabase.storage
        .from("generation-outputs")
        .list(`${user.id}/${selectedProjectId}`, {
          limit: 100,
          offset: 0,
          sortBy: { column: "created_at", order: "desc" },
        });

      if (listError) {
        setError(`Failed to list output files: ${listError.message}`);
        setTestResults((prev) => ({ ...prev, outputListing: "FAIL" }));
        setOutputFiles([]);
        return;
      }

      const files = (data || [])
        .filter((item) => item.name !== ".emptyFolderPlaceholder")
        .map((item) => ({
          name: item.name,
          path: `${user.id}/${selectedProjectId}/${item.name}`,
        }));

      setOutputFiles(files);
      setTestResults((prev) => ({ ...prev, outputListing: "PASS" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list output files");
      setTestResults((prev) => ({ ...prev, outputListing: "FAIL" }));
      setOutputFiles([]);
    } finally {
      setOutputFilesLoading(false);
    }
  }, [supabase, user, selectedProjectId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (selectedProjectId && user) {
      listOutputFiles();
    }
  }, [selectedProjectId, user, listOutputFiles]);

  // Get signed URL
  const getSignedUrl = async (bucket: string, path: string) => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 3600);

      if (error || !data?.signedUrl) {
        setError(`Failed to create signed URL: ${error?.message}`);
        return;
      }

      window.open(data.signedUrl, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create signed URL");
    }
  };

  // Clear messages
  useEffect(() => {
    if (successMessage) {
      const timeout = setTimeout(() => setSuccessMessage(null), 4000);
      return () => clearTimeout(timeout);
    }
  }, [successMessage]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Generations & Storage Test</h1>
          <div className="text-gray-400">Loading authentication...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Generations & Storage Test</h1>
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-4">
            <p className="text-red-300">You must be signed in to use this page.</p>
            <button
              onClick={() => openModal("signin")}
              className="text-[#D97757] hover:text-[#e98566] underline mt-2 inline-block bg-none border-none cursor-pointer"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Generations & Storage Test</h1>
          <p className="text-gray-400">
            User: {user?.emailAddresses[0]?.emailAddress || user?.username || "Unknown"}
          </p>
          <Link
            href="/test/projects"
            className="text-[#D97757] hover:text-[#e98566] text-sm mt-2 inline-block"
          >
            ← Projects Test
          </Link>
        </div>

        {/* Messages */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-4 flex justify-between items-start">
            <p className="text-red-300">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 mb-4 flex justify-between items-start">
            <p className="text-green-300">{successMessage}</p>
            <button
              onClick={() => setSuccessMessage(null)}
              className="text-green-400 hover:text-green-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Project Selection */}
        <div className="bg-gray-900 rounded-lg p-6 mb-8 border border-gray-800">
          <h2 className="text-xl font-bold mb-4">Project Selection</h2>

          {projectsLoading ? (
            <div className="text-gray-400">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="bg-gray-800/50 rounded p-4 text-gray-400">
              <p>No projects found.</p>
              <Link
                href="/test/projects"
                className="text-[#D97757] hover:text-[#e98566] underline mt-2 inline-block"
              >
                Create a project first
              </Link>
            </div>
          ) : (
            <select
              value={selectedProjectId || ""}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white focus:border-[#D97757] focus:outline-none"
            >
              <option value="">Select a project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {selectedProjectId && (
          <>
            {/* Generation Creation */}
            <div className="bg-gray-900 rounded-lg p-6 mb-8 border border-gray-800">
              <h2 className="text-xl font-bold mb-4">Create Generation</h2>

              <form onSubmit={handleCreateGeneration} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Type
                    </label>
                    <select
                      value={generationType}
                      onChange={(e) => setGenerationType(e.target.value as GenerationType)}
                      disabled={generationSubmitting}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-[#D97757] focus:outline-none disabled:opacity-50"
                    >
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="audio">Audio</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Provider
                    </label>
                    <input
                      type="text"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      disabled={generationSubmitting}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-[#D97757] focus:outline-none disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Model
                    </label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={generationSubmitting}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-[#D97757] focus:outline-none disabled:opacity-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Prompt
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={generationSubmitting}
                    rows={2}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-[#D97757] focus:outline-none disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Negative Prompt (optional)
                  </label>
                  <input
                    type="text"
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    disabled={generationSubmitting}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-[#D97757] focus:outline-none disabled:opacity-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={generationSubmitting}
                  className="w-full bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generationSubmitting ? "Creating..." : "Create Generation"}
                </button>
              </form>
            </div>

            {/* Generations List */}
            <div className="bg-gray-900 rounded-lg p-6 mb-8 border border-gray-800">
              <h2 className="text-xl font-bold mb-4">Generations List</h2>

              {generationsLoading ? (
                <div className="text-gray-400">Loading generations...</div>
              ) : generations.length === 0 ? (
                <div className="text-gray-400">No generations yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-700">
                      <tr>
                        <th className="text-left py-2 px-2">ID</th>
                        <th className="text-left py-2 px-2">Type</th>
                        <th className="text-left py-2 px-2">Provider</th>
                        <th className="text-left py-2 px-2">Model</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-left py-2 px-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generations.map((gen) => (
                        <tr key={gen.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                          <td className="py-2 px-2 font-mono text-xs text-gray-400">
                            {gen.id.slice(0, 8)}...
                          </td>
                          <td className="py-2 px-2">{gen.generation_type}</td>
                          <td className="py-2 px-2">{gen.provider}</td>
                          <td className="py-2 px-2">{gen.model}</td>
                          <td className="py-2 px-2">
                            <span
                              className={`px-2 py-1 rounded text-xs ${
                                gen.status === "completed"
                                  ? "bg-green-900/30 text-green-300"
                                  : gen.status === "failed"
                                  ? "bg-red-900/30 text-red-300"
                                  : "bg-yellow-900/30 text-yellow-300"
                              }`}
                            >
                              {gen.status}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-xs text-gray-400">
                            {new Date(gen.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* File Upload */}
            <div className="bg-gray-900 rounded-lg p-6 mb-8 border border-gray-800">
              <h2 className="text-xl font-bold mb-4">Upload to generation-inputs</h2>

              <form onSubmit={handleFileUpload} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Select File (Max 50 MB, allowed types: JPEG, PNG, WebP, MP4, WebM, MP3,
                    WAV, OGG)
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    disabled={uploading}
                    accept={ALLOWED_MIME_TYPES.join(",")}
                    className="w-full"
                  />
                </div>

                {uploadFile && (
                  <div className="text-sm text-gray-400">
                    File: {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!uploadFile || uploading}
                  className="w-full bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? "Uploading..." : "Upload File"}
                </button>
              </form>
            </div>

            {/* Input Files List */}
            <div className="bg-gray-900 rounded-lg p-6 mb-8 border border-gray-800">
              <h2 className="text-xl font-bold mb-4">Input Files</h2>

              {inputFilesLoading ? (
                <div className="text-gray-400">Loading files...</div>
              ) : inputFiles.length === 0 ? (
                <div className="text-gray-400">No input files uploaded yet</div>
              ) : (
                <div className="space-y-2">
                  {inputFiles.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between bg-gray-800/50 rounded p-3"
                    >
                      <div>
                        <p className="font-mono text-sm text-gray-300">{file.name}</p>
                        <p className="text-xs text-gray-500">{file.path}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => getSignedUrl("generation-inputs", file.path)}
                          className="text-[#D97757] hover:text-[#e98566] text-sm"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => handleDeleteInputFile(file.path)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Security Tests */}
            <div className="bg-gray-900 rounded-lg p-6 mb-8 border border-gray-800">
              <h2 className="text-xl font-bold mb-4">Security Tests</h2>

              <div className="space-y-3">
                <button
                  onClick={testWrongUserFolderRls}
                  className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2 rounded-lg transition-colors"
                >
                  Test blocked upload to another user folder
                </button>

                <button
                  onClick={testBlockedOutputUpload}
                  className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2 rounded-lg transition-colors"
                >
                  Test blocked browser upload to generation-outputs
                </button>
              </div>
            </div>

            {/* Output Files List */}
            <div className="bg-gray-900 rounded-lg p-6 mb-8 border border-gray-800">
              <h2 className="text-xl font-bold mb-4">Generated Output Files</h2>

              {outputFilesLoading ? (
                <div className="text-gray-400">Loading files...</div>
              ) : outputFiles.length === 0 ? (
                <div className="text-gray-400">
                  No generated output files found yet. This is expected until the backend
                  worker is implemented.
                </div>
              ) : (
                <div className="space-y-2">
                  {outputFiles.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between bg-gray-800/50 rounded p-3"
                    >
                      <div>
                        <p className="font-mono text-sm text-gray-300">{file.name}</p>
                        <p className="text-xs text-gray-500">{file.path}</p>
                      </div>
                      <button
                        onClick={() => getSignedUrl("generation-outputs", file.path)}
                        className="text-[#D97757] hover:text-[#e98566] text-sm"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Test Results Summary */}
            <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
              <h2 className="text-xl font-bold mb-4">Test Results</h2>

              <div className="grid grid-cols-2 gap-3">
                {Object.entries(testResults).map(([test, status]) => (
                  <div
                    key={test}
                    className={`rounded p-3 text-sm ${
                      status === "PASS"
                        ? "bg-green-900/30 text-green-300"
                        : status === "FAIL"
                        ? "bg-red-900/30 text-red-300"
                        : "bg-gray-800/50 text-gray-400"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="capitalize">
                        {test.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <span className="font-mono font-bold">{status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
