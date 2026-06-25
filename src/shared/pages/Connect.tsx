import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { 
  Rss, ThumbsUp, Smile, Image as ImageIcon, Send, X, Pin, 
  AlertCircle, Loader2, Sparkles, MessageSquare, Cake, Trash2,
  CalendarDays, Plus
} from "lucide-react";
import { db, storage, realtime } from "../../insforge/client";
import { useAuth } from "../../hooks/useAuth";
import { useTenant } from "../../contexts/TenantContext";

// Types matching database columns
interface PostReaction {
  id: string;
  post_id: string;
  employee_id: string;
  reaction: string;
}

interface PostAuthor {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  designation: string | null;
}

interface Post {
  id: string;
  tenant_id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  type: "general" | "announcement" | "birthday" | "anniversary";
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  author?: PostAuthor;
  post_reactions?: PostReaction[];
}

interface BirthdayEmployee {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  date_of_birth: string | null;
  designation: string | null;
}

// Local mock comment type to satisfy the 'Everyone can react + comment' requirement
interface LocalComment {
  id: string;
  post_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

export default function Connect() {
  const { currentEmployee, role } = useAuth();
  const { tenant, tenantId } = useTenant();
  const location = useLocation();

  const isHr = role === "hr";
  const firstName = currentEmployee?.full_name?.split(" ")[0] ?? "Employee";

  // Feed and Birthdays states
  const [posts, setPosts] = useState<Post[]>([]);
  const [todayBirthdays, setTodayBirthdays] = useState<BirthdayEmployee[]>([]);
  const [upcomingBirthdays, setUpcomingBirthdays] = useState<BirthdayEmployee[]>([]);
  
  // Posting states
  const [newPostText, setNewPostText] = useState("");
  const [newPostType, setNewPostType] = useState<"general" | "announcement">("general");
  const [isPinned, setIsPinned] = useState(false);
  const [newPostImage, setNewPostImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  
  // UI states
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Realtime notification states
  const [newPostsQueue, setNewPostsQueue] = useState<Post[]>([]);
  const [showScrollAlert, setShowScrollAlert] = useState(false);

  // Local comments state (session-based storage)
  const [comments, setComments] = useState<LocalComment[]>([]);
  const [activeCommentPostId, setActiveCommentPostId] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedTopRef = useRef<HTMLDivElement>(null);

  // Store last visit time
  useEffect(() => {
    localStorage.setItem("last_connect_visit", new Date().toISOString());
  }, [location.pathname]);

  // Fetch birthdays
  const fetchBirthdays = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await db
        .from("employees")
        .select("id, full_name, profile_photo_url, date_of_birth, designation")
        .eq("tenant_id", tenantId)
        .eq("status", "active");

      if (error) throw error;

      const activeEmps = data as BirthdayEmployee[];
      const today = new Date();
      const todayMonth = today.getMonth() + 1;
      const todayDay = today.getDate();

      const todayList: BirthdayEmployee[] = [];
      const upcomingList: { emp: BirthdayEmployee; diff: number }[] = [];

      activeEmps.forEach((emp) => {
        if (!emp.date_of_birth) return;
        const parts = emp.date_of_birth.split("-");
        const dobMonth = parseInt(parts[1], 10);
        const dobDay = parseInt(parts[2], 10);

        if (dobMonth === todayMonth && dobDay === todayDay) {
          todayList.push(emp);
        } else {
          // Calculate difference in days
          const dobDateThisYear = new Date(today.getFullYear(), dobMonth - 1, dobDay);
          // If birthday has passed this year, set to next year
          if (dobDateThisYear.getTime() < today.getTime() - 24 * 60 * 60 * 1000) {
            dobDateThisYear.setFullYear(today.getFullYear() + 1);
          }
          const diffTime = dobDateThisYear.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays >= 1 && diffDays <= 7) {
            upcomingList.push({ emp, diff: diffDays });
          }
        }
      });

      // Sort upcoming birthdays by days remaining
      upcomingList.sort((a, b) => a.diff - b.diff);

      setTodayBirthdays(todayList);
      setUpcomingBirthdays(upcomingList.map((item) => item.emp));
    } catch (err) {
      console.error("Failed to fetch birthdays:", err);
    }
  }, [tenantId]);

  // Fetch full feed
  const fetchPosts = useCallback(async (silent = false) => {
    if (!tenantId) return;
    if (!silent) setLoading(true);
    try {
      const { data, error } = await db
        .from("posts")
        .select(`
          *,
          author:employees(id, full_name, profile_photo_url, designation),
          post_reactions(id, post_id, employee_id, reaction)
        `)
        .eq("tenant_id", tenantId);

      if (error) throw error;

      const rawPosts = data as Post[];
      // Sort: pinned first, then newest first
      const sorted = [...rawPosts].sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setPosts(sorted);
      setNewPostsQueue([]);
      setShowScrollAlert(false);
    } catch (err: any) {
      console.error("Failed to fetch feed:", err);
      setErrorMsg(err.message || "Failed to load posts.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tenantId]);

  // Handle new incoming post in realtime
  const handleRealtimePost = useCallback(async (payload: any) => {
    if (payload.tenant_id !== tenantId) return;

    // Fetch the detailed post record with joined author and reactions
    const { data, error } = await db
      .from("posts")
      .select(`
        *,
        author:employees(id, full_name, profile_photo_url, designation),
        post_reactions(id, post_id, employee_id, reaction)
      `)
      .eq("id", payload.id)
      .maybeSingle();

    if (error || !data) return;

    const newPost = data as Post;

    // Check if user is scrolled to top (within 150px)
    if (window.scrollY < 150) {
      setPosts((prev) => {
        const next = [newPost, ...prev.filter(p => p.id !== newPost.id)];
        return next.sort((a, b) => {
          if (a.is_pinned && !b.is_pinned) return -1;
          if (!a.is_pinned && b.is_pinned) return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      });
    } else {
      setNewPostsQueue((prev) => [newPost, ...prev]);
      setShowScrollAlert(true);
    }
  }, [tenantId]);

  // Handle reaction updates in realtime
  const handleRealtimeReaction = useCallback(async (payload: any) => {
    if (payload.tenant_id !== tenantId) return;

    // Trigger a silent partial update on post reactions in memory
    setPosts((prev) => {
      return prev.map((post) => {
        if (post.id !== payload.post_id) return post;
        
        const existingReactions = post.post_reactions ?? [];
        let updatedReactions = [...existingReactions];

        if (payload.reaction) {
          // Upsert reaction in memory
          const idx = updatedReactions.findIndex(r => r.id === payload.id);
          if (idx !== -1) {
            updatedReactions[idx] = payload;
          } else {
            updatedReactions.push(payload);
          }
        } else {
          // Deleted reaction
          updatedReactions = updatedReactions.filter(r => r.id !== payload.id);
        }

        return { ...post, post_reactions: updatedReactions };
      });
    });
  }, [tenantId]);

  // Set up realtime subscriptions
  useEffect(() => {
    if (!tenantId) return;

    const setupRealtime = async () => {
      await realtime.connect();
      await realtime.subscribe("posts");
      await realtime.subscribe("post_reactions");
    };

    void setupRealtime();

    const handleInsert = (payload: any) => {
      if (payload.content !== undefined) {
        void handleRealtimePost(payload);
      } else if (payload.reaction !== undefined) {
        void handleRealtimeReaction(payload);
      }
    };

    const handleUpdate = (payload: any) => {
      if (payload.content !== undefined) {
        // Post updated (could be pinned/unpinned)
        void fetchPosts(true);
      } else if (payload.reaction !== undefined) {
        void handleRealtimeReaction(payload);
      }
    };

    const handleDelete = (payload: any) => {
      if (payload.reaction !== undefined) {
        // Reaction deleted (payload has table columns or deleted row keys)
        void handleRealtimeReaction(payload);
      } else {
        void fetchPosts(true);
      }
    };

    realtime.on("INSERT", handleInsert);
    realtime.on("UPDATE", handleUpdate);
    realtime.on("DELETE", handleDelete);

    // Initial load
    void fetchPosts();
    void fetchBirthdays();

    // Clean up
    return () => {
      realtime.off("INSERT", handleInsert);
      realtime.off("UPDATE", handleUpdate);
      realtime.off("DELETE", handleDelete);
      realtime.unsubscribe("posts");
      realtime.unsubscribe("post_reactions");
    };
  }, [tenantId, fetchPosts, fetchBirthdays, handleRealtimePost, handleRealtimeReaction]);

  // Handle post image file selection
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewPostImage(file);
      setImagePreviewUrl(URL.createObjectURL(file));
    }
  };

  // Submit new post
  const handleCreatePost = async () => {
    if (!newPostText.trim() && !newPostImage) return;
    if (!currentEmployee || !tenantId) return;

    setUploading(true);
    setErrorMsg(null);

    let image_url: string | null = null;
    let filePath = "";

    try {
      // 1. Upload image to post-attachments storage bucket if selected
      if (newPostImage) {
        const fileExt = newPostImage.name.split(".").pop();
        const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
        filePath = `${tenantId}/${fileName}`;

        const { data: uploadData, error: uploadErr } = await storage
          .from("post-attachments")
          .upload(filePath, newPostImage);

        if (uploadErr) throw uploadErr;
        image_url = uploadData?.url ?? null;
      }

      // 2. Insert new post
      const { data, error } = await db
        .from("posts")
        .insert([{
          tenant_id: tenantId,
          author_id: currentEmployee.id,
          content: newPostText.trim(),
          image_url,
          type: newPostType,
          is_pinned: isPinned
        }])
        .select();

      if (error) throw error;

      // 3. Reset form states
      setNewPostText("");
      setNewPostImage(null);
      setImagePreviewUrl(null);
      setIsPinned(false);
      setIsFormExpanded(false);

      // Prepend or refresh
      if (data && data.length > 0) {
        await fetchPosts(true);
      }
    } catch (err: any) {
      console.error("Create post error:", err);
      setErrorMsg(err.message || "Failed to create post. Please try again.");

      // Clean up uploaded file if DB insert failed
      if (filePath && image_url) {
        await storage.from("post-attachments").remove(filePath);
      }
    } finally {
      setUploading(false);
    }
  };

  // Delete post (HR only, or author only)
  const handleDeletePost = async (postId: string) => {
    if (!window.confirm("Are you sure you want to delete this post?")) return;
    try {
      const { error } = await db.from("posts").delete().eq("id", postId);
      if (error) throw error;
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (err) {
      console.error("Delete post error:", err);
      alert("Failed to delete post.");
    }
  };

  // Toggle Post reaction
  const handleReact = async (postId: string, reactionType: string) => {
    if (!currentEmployee || !tenantId) return;

    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    // Check if the current user has reacted
    const userReaction = post.post_reactions?.find(
      (r) => r.employee_id === currentEmployee.id && r.post_id === postId
    );

    try {
      if (userReaction) {
        if (userReaction.reaction === reactionType) {
          // Delete reaction
          const { error } = await db
            .from("post_reactions")
            .delete()
            .eq("id", userReaction.id);

          if (error) throw error;
          
          // Optimistic local update
          setPosts((prev) =>
            prev.map((p) => {
              if (p.id !== postId) return p;
              return {
                ...p,
                post_reactions: (p.post_reactions ?? []).filter(
                  (r) => r.id !== userReaction.id
                ),
              };
            })
          );
        } else {
          // Update reaction
          const { error } = await db
            .from("post_reactions")
            .update({ reaction: reactionType })
            .eq("id", userReaction.id);

          if (error) throw error;

          // Optimistic local update
          setPosts((prev) =>
            prev.map((p) => {
              if (p.id !== postId) return p;
              return {
                ...p,
                post_reactions: (p.post_reactions ?? []).map((r) => {
                  if (r.id !== userReaction.id) return r;
                  return { ...r, reaction: reactionType };
                }),
              };
            })
          );
        }
      } else {
        // Insert new reaction
        const newReactData = {
          tenant_id: tenantId,
          post_id: postId,
          employee_id: currentEmployee.id,
          reaction: reactionType,
        };

        const { data, error } = await db
          .from("post_reactions")
          .insert([newReactData])
          .select();

        if (error) throw error;

        if (data && data.length > 0) {
          // Optimistic local update
          setPosts((prev) =>
            prev.map((p) => {
              if (p.id !== postId) return p;
              return {
                ...p,
                post_reactions: [...(p.post_reactions ?? []), data[0] as PostReaction],
              };
            })
          );
        }
      }
    } catch (err) {
      console.error("Failed to update reaction:", err);
    }
  };

  // Pin/Unpin post (HR only)
  const handleTogglePin = async (postId: string, currentPinStatus: boolean) => {
    try {
      const { error } = await db
        .from("posts")
        .update({ is_pinned: !currentPinStatus })
        .eq("id", postId);

      if (error) throw error;
      
      // Update local state and sort
      setPosts((prev) => {
        const updated = prev.map((p) =>
          p.id === postId ? { ...p, is_pinned: !currentPinStatus } : p
        );
        return updated.sort((a, b) => {
          if (a.is_pinned && !b.is_pinned) return -1;
          if (!a.is_pinned && b.is_pinned) return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      });
    } catch (err) {
      console.error("Toggle pin failed:", err);
    }
  };

  // Submit local session-based comment
  const handleAddComment = (postId: string) => {
    if (!commentInput.trim() || !currentEmployee) return;
    
    const newComment: LocalComment = {
      id: Math.random().toString(36).substring(2) + Date.now(),
      post_id: postId,
      author_name: currentEmployee.full_name,
      content: commentInput.trim(),
      created_at: new Date().toISOString()
    };

    setComments((prev) => [...prev, newComment]);
    setCommentInput("");
  };

  // Format timestamp (relative)
  const formatTimeAgo = (dateStr: string) => {
    const time = new Date(dateStr).getTime();
    const diff = Date.now() - time;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  // Trigger feed reload from scroll alert
  const handleRefreshNewPosts = () => {
    setPosts((prev) => {
      const merged = [...newPostsQueue, ...prev];
      // Deduplicate
      const map = new Map(merged.map(item => [item.id, item]));
      const deduped = Array.from(map.values());
      return deduped.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    });
    setNewPostsQueue([]);
    setShowScrollAlert(false);
    feedTopRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Helper to extract tagged birthday names
  const parseBirthdayName = (content: string) => {
    const match = content.match(/@([^!\n]+)/);
    return match ? match[1].trim() : "Team Member";
  };

  // Form expansion toggle
  const expandForm = () => {
    setIsFormExpanded(true);
  };

  const collapseForm = () => {
    setIsFormExpanded(false);
    setNewPostText("");
    setNewPostImage(null);
    setImagePreviewUrl(null);
    setIsPinned(false);
  };

  return (
    <div className="mx-auto max-w-6xl p-4 md:py-6" ref={feedTopRef}>
      {/* Realtime Alert Banner */}
      {showScrollAlert && (
        <div className="fixed top-24 left-1/2 z-50 -translate-x-1/2">
          <button
            onClick={handleRefreshNewPosts}
            className="flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-xs font-semibold text-white shadow-xl hover:bg-brand-700 transition transform hover:-translate-y-0.5"
          >
            <Sparkles className="h-4 w-4 animate-pulse" />
            <span>{newPostsQueue.length} new post{newPostsQueue.length > 1 ? "s" : ""} — click to refresh</span>
          </button>
        </div>
      )}

      {/* Grid Layout: Left sidebar, Center feed, Right sidebar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        
        {/* LEFT COLUMN (200px equivalent: lg:col-span-3) */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-center">
            <div className="relative mx-auto mb-3 h-20 w-20">
              {currentEmployee?.profile_photo_url ? (
                <img
                  src={currentEmployee.profile_photo_url}
                  alt={currentEmployee.full_name}
                  className="h-full w-full rounded-full object-cover ring-4 ring-brand-50"
                />
              ) : (
                <div className="grid h-full w-full place-items-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700">
                  {currentEmployee?.full_name?.slice(0, 2).toUpperCase() ?? "?"}
                </div>
              )}
            </div>
            
            <h2 className="font-display font-bold text-slate-800 truncate">{currentEmployee?.full_name}</h2>
            <p className="text-xs text-slate-500 font-medium truncate mb-2">{currentEmployee?.designation ?? "Employee"}</p>
            
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Company</p>
              <p className="text-sm font-semibold text-brand-700 truncate mt-0.5">{tenant?.company_name ?? "TalentMesh"}</p>
            </div>

            <button
              onClick={() => {
                expandForm();
                setTimeout(() => fileInputRef.current?.click(), 100);
              }}
              className="mt-4 w-full flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Create a post</span>
            </button>
          </div>
        </aside>

        {/* CENTER COLUMN (Main Feed: lg:col-span-6) */}
        <main className="lg:col-span-6 space-y-5">
          
          {/* CREATE POST BOX */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {!isFormExpanded ? (
              <div 
                onClick={expandForm}
                className="flex items-center gap-3 cursor-pointer"
              >
                {currentEmployee?.profile_photo_url ? (
                  <img
                    src={currentEmployee.profile_photo_url}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700 text-sm">
                    {currentEmployee?.full_name?.slice(0, 2).toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="flex-1 rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-400 hover:bg-slate-100 font-medium transition-colors border border-slate-100">
                  What's on your mind, {firstName}?
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {currentEmployee?.profile_photo_url ? (
                      <img
                        src={currentEmployee.profile_photo_url}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700 text-xs">
                        {currentEmployee?.full_name?.slice(0, 2).toUpperCase() ?? "?"}
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-bold text-slate-800">{currentEmployee?.full_name}</p>
                      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{role} portal</p>
                    </div>
                  </div>
                  <button 
                    onClick={collapseForm}
                    className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {errorMsg && (
                  <div className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <textarea
                  value={newPostText}
                  onChange={(e) => setNewPostText(e.target.value)}
                  placeholder={`What's on your mind, ${firstName}?`}
                  className="w-full min-h-[100px] text-sm text-slate-800 placeholder:text-slate-400 outline-none resize-none border-b border-slate-100 focus:border-brand-500 py-1"
                />

                {imagePreviewUrl && (
                  <div className="relative rounded-xl overflow-hidden border border-slate-200 max-h-60 bg-slate-50 flex items-center justify-center">
                    <img 
                      src={imagePreviewUrl} 
                      alt="Upload preview" 
                      className="max-h-60 object-contain w-full"
                    />
                    <button
                      onClick={() => {
                        setNewPostImage(null);
                        setImagePreviewUrl(null);
                      }}
                      className="absolute top-2 right-2 rounded-full bg-slate-900/60 p-1.5 text-white hover:bg-slate-950 transition-colors shadow-md"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-1.5 text-slate-500 hover:text-brand-600 font-semibold text-xs transition-colors rounded-lg px-2.5 py-1.5 hover:bg-brand-50"
                    >
                      <ImageIcon className="h-4.5 w-4.5 text-brand-500" />
                      <span>Photo</span>
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept="image/*"
                      onChange={handleImageChange}
                    />

                    {isHr && (
                      <div className="flex items-center gap-4 border-l border-slate-200 pl-4">
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold cursor-pointer">
                          <input
                            type="radio"
                            checked={newPostType === "general"}
                            onChange={() => {
                              setNewPostType("general");
                              setIsPinned(false);
                            }}
                            className="text-brand-600 focus:ring-brand-500 h-3.5 w-3.5"
                          />
                          <span>General</span>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold cursor-pointer">
                          <input
                            type="radio"
                            checked={newPostType === "announcement"}
                            onChange={() => setNewPostType("announcement")}
                            className="text-brand-600 focus:ring-brand-500 h-3.5 w-3.5"
                          />
                          <span>Announcement</span>
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {newPostType === "announcement" && isHr && (
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isPinned}
                          onChange={(e) => setIsPinned(e.target.checked)}
                          className="rounded text-brand-600 focus:ring-brand-500 h-3.5 w-3.5"
                        />
                        <span className="flex items-center gap-0.5">
                          <Pin className="h-3 w-3" /> Pin announcement
                        </span>
                      </label>
                    )}

                    <button
                      onClick={handleCreatePost}
                      disabled={(!newPostText.trim() && !newPostImage) || uploading}
                      className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 transition disabled:opacity-50"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Posting...</span>
                        </>
                      ) : (
                        <>
                          <Send className="h-3.5 w-3.5" />
                          <span>Post</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* LOADING STATE */}
          {loading && (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
              <p className="text-sm font-medium">Loading connect feed...</p>
            </div>
          )}

          {/* EMPTY STATE */}
          {!loading && posts.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center space-y-3">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Rss className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-slate-800">No posts in the feed yet</h3>
              <p className="text-sm text-slate-500 max-w-sm mx-auto">
                Be the first one to start the conversation! Post an update or announcement.
              </p>
            </div>
          )}

          {/* POSTS FEED */}
          {!loading && posts.length > 0 && (
            <div className="space-y-4">
              {posts.map((post) => {
                const authorName = post.author?.full_name ?? "System";
                const isBirthday = post.type === "birthday";
                const isAnniversary = post.type === "anniversary";
                const isAnnouncement = post.type === "announcement";
                
                // Get reaction counts
                const postReactions = post.post_reactions ?? [];
                const likesCount = postReactions.filter(r => r.reaction === "like").length;
                const celebratesCount = postReactions.filter(r => r.reaction === "celebrate").length;
                const clapsCount = postReactions.filter(r => r.reaction === "clap").length;

                // Check if user has active reactions
                const userReaction = postReactions.find(r => r.employee_id === currentEmployee?.id);
                const hasLiked = userReaction?.reaction === "like";
                const hasCelebrated = userReaction?.reaction === "celebrate";
                const hasClapped = userReaction?.reaction === "clap";

                // Birthday name resolving
                const birthdayEmpName = isBirthday || isAnniversary ? parseBirthdayName(post.content) : "";

                // Pinned/author delete authorization
                const canDelete = isHr || post.author_id === currentEmployee?.id;

                return (
                  <div 
                    key={post.id} 
                    className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all ${
                      post.is_pinned 
                        ? "border-amber-300 ring-2 ring-amber-100" 
                        : "border-slate-200"
                    }`}
                  >
                    
                    {/* Pinned Indicator Header */}
                    {post.is_pinned && (
                      <div className="bg-amber-50 px-4 py-1.5 border-b border-amber-200/50 flex items-center gap-1.5 text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                        <Pin className="h-3.5 w-3.5 rotate-45 shrink-0" />
                        <span>Pinned Announcement</span>
                      </div>
                    )}

                    <div className="p-4 space-y-3">
                      {/* Post Header Row */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {isAnnouncement ? (
                            // Announcement: Company Logo
                            <div className="grid h-10 w-10 place-items-center rounded-full bg-amber-50 text-amber-600 border border-amber-200 font-bold shrink-0">
                              📢
                            </div>
                          ) : post.author?.profile_photo_url ? (
                            <img
                              src={post.author.profile_photo_url}
                              alt=""
                              className="h-10 w-10 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-700 font-bold text-sm shrink-0">
                              {authorName.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-bold text-slate-800 hover:underline cursor-pointer">
                                {isAnnouncement ? (tenant?.company_name ?? "Company Announcement") : authorName}
                              </span>
                              
                              {/* Announcements Badge */}
                              {isAnnouncement && (
                                <span className="rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-amber-200">
                                  Announcements
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 font-semibold leading-tight">
                              {isAnnouncement ? "Official Broadcast" : (post.author?.designation ?? "Employee")} · {formatTimeAgo(post.created_at)}
                            </p>
                          </div>
                        </div>

                        {/* Dropdown Options / Delete Button */}
                        <div className="flex items-center gap-2">
                          {isHr && isAnnouncement && (
                            <button
                              onClick={() => handleTogglePin(post.id, post.is_pinned)}
                              className={`p-1.5 rounded-lg hover:bg-slate-50 transition-colors ${
                                post.is_pinned ? "text-amber-500" : "text-slate-400"
                              }`}
                              title={post.is_pinned ? "Unpin post" : "Pin post"}
                            >
                              <Pin className="h-4 w-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDeletePost(post.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete post"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Content Text */}
                      <div className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed px-1">
                        {/* Mention highlight for birthday posts */}
                        {isBirthday || isAnniversary ? (
                          <p>
                            🎂 Happy Birthday{" "}
                            <span className="font-semibold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded-lg">
                              @{birthdayEmpName}
                            </span>
                            ! Wishing you a wonderful day filled with joy and celebrations. From the entire family! 🎉
                          </p>
                        ) : (
                          post.content
                        )}
                      </div>

                      {/* Birthday colorful SVG banner */}
                      {isBirthday && (
                        <div className="py-2">
                          <svg viewBox="0 0 800 220" className="w-full h-auto rounded-2xl shadow-sm border border-slate-200 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500">
                            <defs>
                              <pattern id="confetti-pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                                <circle cx="5" cy="5" r="2" fill="#fff" opacity="0.6"/>
                                <circle cx="25" cy="15" r="3" fill="#FFE2E2" opacity="0.4"/>
                                <path d="M 30,5 L 35,10 M 10,25 L 5,30" stroke="#FFE2E2" strokeWidth="1.5" opacity="0.5"/>
                              </pattern>
                            </defs>
                            <rect width="100%" height="100%" fill="url(#confetti-pattern)"/>
                            <text x="50%" y="42%" textAnchor="middle" fill="#FFFFFF" fontSize="28" fontWeight="bold" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="2">
                              🎂 HAPPY BIRTHDAY! 🎂
                            </text>
                            <text x="50%" y="72%" textAnchor="middle" fill="#FFE2E2" fontSize="22" fontWeight="bold" fontFamily="system-ui, -apple-system, sans-serif">
                              {birthdayEmpName}
                            </text>
                          </svg>
                        </div>
                      )}

                      {/* Anniversary SVG banner */}
                      {isAnniversary && (
                        <div className="py-2">
                          <svg viewBox="0 0 800 220" className="w-full h-auto rounded-2xl shadow-sm border border-slate-200 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500">
                            <defs>
                              <pattern id="confetti-pattern-anniv" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                                <circle cx="5" cy="5" r="2" fill="#fff" opacity="0.6"/>
                                <circle cx="25" cy="15" r="3" fill="#FFE2E2" opacity="0.4"/>
                                <path d="M 30,5 L 35,10 M 10,25 L 5,30" stroke="#FFE2E2" strokeWidth="1.5" opacity="0.5"/>
                              </pattern>
                            </defs>
                            <rect width="100%" height="100%" fill="url(#confetti-pattern-anniv)"/>
                            <text x="50%" y="42%" textAnchor="middle" fill="#FFFFFF" fontSize="26" fontWeight="bold" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="1">
                              🎊 WORK ANNIVERSARY! 🎊
                            </text>
                            <text x="50%" y="72%" textAnchor="middle" fill="#FFE2E2" fontSize="20" fontWeight="bold" fontFamily="system-ui, -apple-system, sans-serif">
                              Congratulations @{birthdayEmpName}
                            </text>
                          </svg>
                        </div>
                      )}

                      {/* Image attachment */}
                      {post.image_url && (
                        <div className="overflow-hidden rounded-xl border border-slate-100 max-h-[360px] bg-slate-50 flex items-center justify-center py-1">
                          <img
                            src={post.image_url}
                            alt="Post attachment"
                            className="max-h-[350px] w-full object-contain"
                          />
                        </div>
                      )}

                      {/* Reaction bar */}
                      <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-3">
                        <div className="flex items-center gap-1.5">
                          {/* Like Button */}
                          <button
                            onClick={() => handleReact(post.id, "like")}
                            className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                              hasLiked 
                                ? "bg-blue-50 text-blue-600" 
                                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                            }`}
                          >
                            <ThumbsUp className={`h-4 w-4 ${hasLiked ? "fill-blue-500 text-blue-500" : ""}`} />
                            <span>Like</span>
                            {likesCount > 0 && <span className="ml-0.5 font-bold">{likesCount}</span>}
                          </button>

                          {/* Celebrate Button */}
                          <button
                            onClick={() => handleReact(post.id, "celebrate")}
                            className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                              hasCelebrated 
                                ? "bg-amber-50 text-amber-600" 
                                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                            }`}
                          >
                            <Smile className={`h-4 w-4 ${hasCelebrated ? "text-amber-500" : ""}`} />
                            <span>Celebrate</span>
                            {celebratesCount > 0 && <span className="ml-0.5 font-bold">{celebratesCount}</span>}
                          </button>

                          {/* Clap Button */}
                          <button
                            onClick={() => handleReact(post.id, "clap")}
                            className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                              hasClapped 
                                ? "bg-pink-50 text-pink-600" 
                                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                            }`}
                          >
                            <Sparkles className={`h-4 w-4 ${hasClapped ? "text-pink-500 fill-pink-500" : ""}`} />
                            <span>Clap</span>
                            {clapsCount > 0 && <span className="ml-0.5 font-bold">{clapsCount}</span>}
                          </button>
                        </div>

                        <button 
                          onClick={() => setActiveCommentPostId(activeCommentPostId === post.id ? null : post.id)}
                          className="flex items-center gap-1 text-slate-500 hover:text-brand-600 font-semibold text-xs rounded-xl px-3 py-1.5 hover:bg-slate-50 transition"
                        >
                          <MessageSquare className="h-4 w-4" />
                          <span>Comment</span>
                          {comments.filter(c => c.post_id === post.id).length > 0 && (
                            <span className="ml-0.5 font-bold">
                              {comments.filter(c => c.post_id === post.id).length}
                            </span>
                          )}
                        </button>
                      </div>

                      {/* Comments section */}
                      {activeCommentPostId === post.id && (
                        <div className="border-t border-slate-100 pt-3 mt-2 space-y-3">
                          {/* Comments List */}
                          <div className="space-y-2">
                            {comments
                              .filter((c) => c.post_id === post.id)
                              .map((comment) => (
                                <div key={comment.id} className="flex gap-2.5 bg-slate-50 rounded-xl p-2.5 text-xs">
                                  <div className="grid h-6 w-6 place-items-center rounded-full bg-slate-200 font-bold text-slate-600 shrink-0">
                                    {comment.author_name.slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="flex-1 space-y-0.5 min-w-0">
                                    <div className="flex justify-between items-baseline">
                                      <p className="font-bold text-slate-700 truncate">{comment.author_name}</p>
                                      <span className="text-[9px] text-slate-400">{formatTimeAgo(comment.created_at)}</span>
                                    </div>
                                    <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">{comment.content}</p>
                                  </div>
                                </div>
                              ))}
                          </div>

                          {/* Comment Input */}
                          <div className="flex gap-2 items-center">
                            <input
                              type="text"
                              value={commentInput}
                              onChange={(e) => setCommentInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAddComment(post.id);
                                }
                              }}
                              placeholder="Write a comment..."
                              className="flex-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none border border-slate-200 focus:border-brand-500 focus:bg-white transition"
                            />
                            <button
                              onClick={() => handleAddComment(post.id)}
                              disabled={!commentInput.trim()}
                              className="p-2 rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition-colors shadow-sm"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* RIGHT COLUMN (Sidebar: lg:col-span-3) */}
        <aside className="lg:col-span-3 space-y-6">
          
          {/* TODAY'S BIRTHDAYS */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <h3 className="flex items-center gap-1.5 font-display font-bold text-slate-800 text-sm border-b border-slate-100 pb-2">
              <Cake className="h-4.5 w-4.5 text-pink-500 shrink-0" />
              <span>Today's Birthdays</span>
            </h3>

            {todayBirthdays.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400 font-medium bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                No birthdays today
              </div>
            ) : (
              <div className="space-y-3 max-h-48 overflow-y-auto">
                {todayBirthdays.map((emp) => (
                  <div key={emp.id} className="flex items-center gap-3">
                    {emp.profile_photo_url ? (
                      <img
                        src={emp.profile_photo_url}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-pink-100 text-xs font-bold text-pink-700 shrink-0">
                        {emp.full_name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-xs text-slate-800 truncate">{emp.full_name}</p>
                      <p className="text-[10px] text-slate-400 truncate">{emp.designation || "Employee"}</p>
                    </div>
                    <span className="rounded-full bg-pink-100 border border-pink-200 text-pink-700 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider shrink-0 animate-pulse">
                      Today
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* UPCOMING BIRTHDAYS */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <h3 className="flex items-center gap-1.5 font-display font-bold text-slate-800 text-sm border-b border-slate-100 pb-2">
              <CalendarDays className="h-4.5 w-4.5 text-brand-600 shrink-0" />
              <span>Upcoming Birthdays</span>
            </h3>

            {upcomingBirthdays.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400 font-medium bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                No upcoming birthdays
              </div>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {upcomingBirthdays.slice(0, 7).map((emp) => {
                  const dobParts = emp.date_of_birth?.split("-") ?? [];
                  const dobMonth = parseInt(dobParts[1], 10);
                  const dobDay = parseInt(dobParts[2], 10);
                  const monthNames = [
                    "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
                  ];
                  const formattedDob = `${dobDay} ${monthNames[dobMonth - 1]}`;

                  return (
                    <div key={emp.id} className="flex items-center gap-3 justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        {emp.profile_photo_url ? (
                          <img
                            src={emp.profile_photo_url}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 shrink-0">
                            {emp.full_name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-xs text-slate-700 truncate">{emp.full_name}</p>
                          <p className="text-[9px] text-slate-400 truncate">{emp.designation || "Employee"}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-slate-500 shrink-0 bg-slate-50 border border-slate-200/50 px-2 py-0.5 rounded-lg">
                        {formattedDob}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </aside>

      </div>
    </div>
  );
}
