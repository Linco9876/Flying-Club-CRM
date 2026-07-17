import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../../context/AuthContext";
import {
  type InstructorComplianceCheckType,
  type InstructorComplianceCourse,
  type InstructorComplianceCourseItem,
  type InstructorComplianceLevel,
  type SaveInstructorComplianceTemplate,
  useInstructorCompliance,
} from "../../hooks/useInstructorCompliance";
import { hasRole } from "../../utils/rbac";

type EditorStep = "basics" | "checklist" | "review";
type DraftItem = SaveInstructorComplianceTemplate["items"][number] & {
  key: string;
};
type DraftSource =
  SaveInstructorComplianceTemplate["sourceDocuments"][number] & { key: string };
type TemplateDraft = Omit<
  SaveInstructorComplianceTemplate,
  "items" | "sourceDocuments"
> & {
  items: DraftItem[];
  sourceDocuments: DraftSource[];
};

const inputClass =
  "mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950 shadow-sm outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200 dark:border-[#39414d] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-cyan-500/25";
const panelClass =
  "rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2c3440] dark:bg-[#171a21]";
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const blankItem = (position: number): DraftItem => ({
  key: uid(),
  section: "General assessment",
  code: `ITEM-${String(position + 1).padStart(2, "0")}`,
  title: "",
  guidance: "",
  required: true,
  applicableLevels: ["instructor", "senior_instructor"],
  applicableCheckTypes: ["initial_issue", "sp_check", "renewal"],
});

const blankTemplate = (): TemplateDraft => ({
  name: "",
  description: "",
  version: "1.0",
  sourceDocuments: [],
  isActive: true,
  items: [blankItem(0)],
});

const toDraft = (
  course: InstructorComplianceCourse,
  allItems: InstructorComplianceCourseItem[],
): TemplateDraft => ({
  id: course.id,
  name: course.name,
  description: course.description,
  version: course.version,
  sourceDocuments: course.sourceDocuments.map((document) => ({
    ...document,
    key: uid(),
  })),
  isActive: course.isActive,
  items: allItems
    .filter((item) => item.courseId === course.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      key: item.id,
      section: item.section,
      code: item.code,
      title: item.title,
      guidance: item.guidance,
      required: item.required,
      applicableLevels: [...item.applicableLevels],
      applicableCheckTypes: [...item.applicableCheckTypes],
    })),
});

const checkTypeLabel: Record<InstructorComplianceCheckType, string> = {
  initial_issue: "Initial issue",
  sp_check: "S&P check",
  renewal: "Renewal",
};

const levelLabel: Record<InstructorComplianceLevel, string> = {
  instructor: "Instructor",
  senior_instructor: "Senior Instructor",
};

export const InstructorReviewTemplateWorkspace: React.FC = () => {
  const { user } = useAuth();
  const isCfi = hasRole(user, "cfi");
  const { courses, items, loading, error, saveTemplate } =
    useInstructorCompliance({
      enabled: isCfi,
      includeRecords: false,
    });
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [step, setStep] = useState<EditorStep>("basics");
  const [saving, setSaving] = useState(false);

  const itemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) =>
      counts.set(item.courseId, (counts.get(item.courseId) || 0) + 1),
    );
    return counts;
  }, [items]);

  const openEditor = (course?: InstructorComplianceCourse) => {
    setDraft(course ? toDraft(course, items) : blankTemplate());
    setStep("basics");
  };

  const updateItem = (key: string, update: Partial<DraftItem>) => {
    setDraft(
      (current) =>
        current && {
          ...current,
          items: current.items.map((item) =>
            item.key === key ? { ...item, ...update } : item,
          ),
        },
    );
  };

  const toggleLevel = (item: DraftItem, level: InstructorComplianceLevel) => {
    const next = item.applicableLevels.includes(level)
      ? item.applicableLevels.filter((value) => value !== level)
      : [...item.applicableLevels, level];
    updateItem(item.key, { applicableLevels: next });
  };

  const toggleCheckType = (
    item: DraftItem,
    checkType: InstructorComplianceCheckType,
  ) => {
    const next = item.applicableCheckTypes.includes(checkType)
      ? item.applicableCheckTypes.filter((value) => value !== checkType)
      : [...item.applicableCheckTypes, checkType];
    updateItem(item.key, { applicableCheckTypes: next });
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.items.length) return current;
      const next = [...current.items];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, items: next };
    });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Form name is required");
      setStep("basics");
      return;
    }
    if (draft.items.length === 0) {
      toast.error("Add at least one checklist item");
      setStep("checklist");
      return;
    }
    const invalidItem = draft.items.find(
      (item) =>
        !item.code.trim() ||
        !item.section.trim() ||
        !item.title.trim() ||
        item.applicableLevels.length === 0 ||
        item.applicableCheckTypes.length === 0,
    );
    if (invalidItem) {
      toast.error(
        "Every checklist item needs a code, section, title and applicability",
      );
      setStep("checklist");
      return;
    }
    const codes = draft.items.map((item) => item.code.trim().toUpperCase());
    if (new Set(codes).size !== codes.length) {
      toast.error("Checklist codes must be unique");
      setStep("checklist");
      return;
    }

    setSaving(true);
    try {
      await saveTemplate({
        ...draft,
        sourceDocuments: draft.sourceDocuments.map((document) => ({
          name: document.name,
          purpose: document.purpose,
        })),
        items: draft.items.map((item) => ({
          section: item.section,
          code: item.code,
          title: item.title,
          guidance: item.guidance,
          required: item.required,
          applicableLevels: item.applicableLevels,
          applicableCheckTypes: item.applicableCheckTypes,
        })),
      });
      toast.success("Instructor review form saved");
      setDraft(null);
    } catch (saveError) {
      console.error("Failed to save instructor review form:", saveError);
      toast.error(
        saveError instanceof Error ? saveError.message : "Failed to save form",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!isCfi) {
    return (
      <div className={`${panelClass} p-8 text-center`}>
        <LockKeyhole className="mx-auto h-10 w-10 text-gray-400" />
        <h2 className="mt-3 text-lg font-bold text-gray-900 dark:text-gray-100">
          CFI access required
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Only a CFI can change the forms used for instructor issues, S&amp;P
          checks and renewals.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
        Loading instructor review forms...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl bg-gradient-to-r from-slate-950 via-cyan-950 to-slate-900 text-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-cyan-200">
              <ShieldCheck className="h-4 w-4" />
              CFI form template library
            </div>
            <h1 className="mt-2 text-2xl font-bold">Instructor Reviews</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-100">
              Edit the protected forms completed for instructor initial issues,
              Standards &amp; Proficiency checks and renewals. Past results stay
              in the instructor's profile and the Safety register.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openEditor()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500"
          >
            <Plus className="h-4 w-4" />
            New form
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        {courses.map((course) => (
          <article key={course.id} className={`${panelClass} overflow-hidden`}>
            <div className="border-l-4 border-cyan-600 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="rounded-full bg-cyan-100 px-2 py-1 text-xs font-bold text-cyan-900 dark:bg-cyan-500/15 dark:text-cyan-200">
                    Instructor compliance form
                  </span>
                  <h2 className="mt-3 text-lg font-bold text-gray-950 dark:text-gray-100">
                    {course.name}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                    {course.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEditor(course)}
                  title="Edit form"
                  className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 dark:border-[#39414d] dark:text-gray-300 dark:hover:bg-[#11141a]"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                <span className="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                  v{course.version}
                </span>
                <span className="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                  {itemCounts.get(course.id) || 0} checklist items
                </span>
                <span className="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                  {course.sourceDocuments.length} source documents
                </span>
              </div>
            </div>
          </article>
        ))}
        {courses.length === 0 && (
          <div className={`${panelClass} p-10 text-center lg:col-span-2`}>
            <FileText className="mx-auto h-9 w-9 text-gray-400" />
            <h2 className="mt-3 font-bold text-gray-950 dark:text-gray-100">
              No instructor review form configured
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Create the first protected CFI checklist.
            </p>
          </div>
        )}
      </section>

      {draft && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:p-6">
          <div className="my-auto w-full max-w-6xl overflow-hidden rounded-xl bg-gray-50 shadow-2xl dark:bg-[#0f1218]">
            <header className="flex items-start justify-between gap-4 bg-gradient-to-r from-slate-950 via-cyan-950 to-slate-900 px-4 py-5 text-white sm:px-6">
              <div>
                <p className="text-xs font-bold uppercase text-cyan-200">
                  CFI form editor
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  {draft.id
                    ? `Edit ${draft.name}`
                    : "New instructor review form"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg p-2 hover:bg-white/10"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="grid grid-cols-3 gap-2 border-b border-gray-200 bg-white p-3 dark:border-[#2c3440] dark:bg-[#171a21]">
              {(
                [
                  { id: "basics", label: "1. Basics" },
                  { id: "checklist", label: "2. Checklist" },
                  { id: "review", label: "3. Review" },
                ] as Array<{ id: EditorStep; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStep(tab.id)}
                  className={`rounded-lg px-3 py-2 text-sm font-bold ${step === tab.id ? "bg-cyan-700 text-white" : "bg-gray-100 text-gray-600 dark:bg-[#232832] dark:text-gray-300"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="max-h-[72vh] overflow-y-auto p-4 sm:p-6">
              {step === "basics" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Form name
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft(
                          (current) =>
                            current && { ...current, name: event.target.value },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Version
                    <input
                      value={draft.version}
                      onChange={(event) =>
                        setDraft(
                          (current) =>
                            current && {
                              ...current,
                              version: event.target.value,
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="sm:col-span-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                    Purpose and instructions
                    <textarea
                      rows={4}
                      value={draft.description}
                      onChange={(event) =>
                        setDraft(
                          (current) =>
                            current && {
                              ...current,
                              description: event.target.value,
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-gray-950 dark:text-gray-100">
                          Source documents
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Record the standards used to build this form.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft(
                            (current) =>
                              current && {
                                ...current,
                                sourceDocuments: [
                                  ...current.sourceDocuments,
                                  { key: uid(), name: "", purpose: "" },
                                ],
                              },
                          )
                        }
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-cyan-300 px-3 py-2 text-sm font-bold text-cyan-800 dark:border-cyan-500/30 dark:text-cyan-200"
                      >
                        <Plus className="h-4 w-4" />
                        Add source
                      </button>
                    </div>
                    <div className="mt-3 space-y-3">
                      {draft.sourceDocuments.map((document, index) => (
                        <div
                          key={document.key}
                          className="grid gap-3 rounded-lg border border-gray-200 p-3 dark:border-[#39414d] sm:grid-cols-[1fr_1fr_auto]"
                        >
                          <input
                            aria-label={`Source document ${index + 1} name`}
                            placeholder="Document name"
                            value={document.name}
                            onChange={(event) =>
                              setDraft(
                                (current) =>
                                  current && {
                                    ...current,
                                    sourceDocuments:
                                      current.sourceDocuments.map((item) =>
                                        item.key === document.key
                                          ? {
                                              ...item,
                                              name: event.target.value,
                                            }
                                          : item,
                                      ),
                                  },
                              )
                            }
                            className={inputClass}
                          />
                          <input
                            aria-label={`Source document ${index + 1} purpose`}
                            placeholder="How it informs the form"
                            value={document.purpose}
                            onChange={(event) =>
                              setDraft(
                                (current) =>
                                  current && {
                                    ...current,
                                    sourceDocuments:
                                      current.sourceDocuments.map((item) =>
                                        item.key === document.key
                                          ? {
                                              ...item,
                                              purpose: event.target.value,
                                            }
                                          : item,
                                      ),
                                  },
                              )
                            }
                            className={inputClass}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setDraft(
                                (current) =>
                                  current && {
                                    ...current,
                                    sourceDocuments:
                                      current.sourceDocuments.filter(
                                        (item) => item.key !== document.key,
                                      ),
                                  },
                              )
                            }
                            className="mt-1 rounded-lg border border-red-200 p-3 text-red-600"
                            title="Remove source"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step === "checklist" && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-gray-950 dark:text-gray-100">
                        Checklist and applicability
                      </h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Define exactly what the CFI assesses and when each item
                        appears.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft(
                          (current) =>
                            current && {
                              ...current,
                              items: [
                                ...current.items,
                                blankItem(current.items.length),
                              ],
                            },
                        )
                      }
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white"
                    >
                      <Plus className="h-4 w-4" />
                      Add item
                    </button>
                  </div>
                  {draft.items.map((item, index) => (
                    <article key={item.key} className={`${panelClass} p-4`}>
                      <div className="grid gap-4 lg:grid-cols-[140px_1fr_auto]">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                          Code
                          <input
                            value={item.code}
                            onChange={(event) =>
                              updateItem(item.key, { code: event.target.value })
                            }
                            className={inputClass}
                          />
                        </label>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                            Section
                            <input
                              value={item.section}
                              onChange={(event) =>
                                updateItem(item.key, {
                                  section: event.target.value,
                                })
                              }
                              className={inputClass}
                            />
                          </label>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                            Assessment item
                            <input
                              value={item.title}
                              onChange={(event) =>
                                updateItem(item.key, {
                                  title: event.target.value,
                                })
                              }
                              className={inputClass}
                            />
                          </label>
                        </div>
                        <div className="flex items-start gap-2 pt-6">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveItem(index, -1)}
                            className="rounded-lg border p-2 disabled:opacity-30"
                            title="Move up"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === draft.items.length - 1}
                            onClick={() => moveItem(index, 1)}
                            className="rounded-lg border p-2 disabled:opacity-30"
                            title="Move down"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraft(
                                (current) =>
                                  current && {
                                    ...current,
                                    items: current.items.filter(
                                      (value) => value.key !== item.key,
                                    ),
                                  },
                              )
                            }
                            className="rounded-lg border border-red-200 p-2 text-red-600"
                            title="Delete item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-200">
                        Guidance for the CFI
                        <textarea
                          rows={2}
                          value={item.guidance}
                          onChange={(event) =>
                            updateItem(item.key, {
                              guidance: event.target.value,
                            })
                          }
                          className={inputClass}
                        />
                      </label>
                      <div className="mt-4 grid gap-4 border-t border-gray-200 pt-4 dark:border-[#39414d] lg:grid-cols-3">
                        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold dark:border-[#39414d]">
                          <input
                            type="checkbox"
                            checked={item.required}
                            onChange={(event) =>
                              updateItem(item.key, {
                                required: event.target.checked,
                              })
                            }
                          />
                          Required to complete
                        </label>
                        <fieldset>
                          <legend className="text-xs font-bold uppercase text-gray-500">
                            Instructor level
                          </legend>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(
                              [
                                "instructor",
                                "senior_instructor",
                              ] as InstructorComplianceLevel[]
                            ).map((level) => (
                              <label
                                key={level}
                                className="flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm dark:border-[#39414d]"
                              >
                                <input
                                  type="checkbox"
                                  checked={item.applicableLevels.includes(
                                    level,
                                  )}
                                  onChange={() => toggleLevel(item, level)}
                                />
                                {levelLabel[level]}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <fieldset>
                          <legend className="text-xs font-bold uppercase text-gray-500">
                            Check type
                          </legend>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(
                              [
                                "initial_issue",
                                "sp_check",
                                "renewal",
                              ] as InstructorComplianceCheckType[]
                            ).map((checkType) => (
                              <label
                                key={checkType}
                                className="flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm dark:border-[#39414d]"
                              >
                                <input
                                  type="checkbox"
                                  checked={item.applicableCheckTypes.includes(
                                    checkType,
                                  )}
                                  onChange={() =>
                                    toggleCheckType(item, checkType)
                                  }
                                />
                                {checkTypeLabel[checkType]}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {step === "review" && (
                <div className="space-y-4">
                  <div className={`${panelClass} p-5`}>
                    <span className="rounded-full bg-cyan-100 px-2 py-1 text-xs font-bold text-cyan-900 dark:bg-cyan-500/15 dark:text-cyan-200">
                      Protected CFI form
                    </span>
                    <h3 className="mt-3 text-xl font-bold text-gray-950 dark:text-gray-100">
                      {draft.name || "Untitled form"}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                      {draft.description || "No purpose recorded."}
                    </p>
                    <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div>
                        <dt className="text-xs font-bold uppercase text-gray-500">
                          Version
                        </dt>
                        <dd className="mt-1 font-semibold dark:text-gray-100">
                          {draft.version}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase text-gray-500">
                          Checklist
                        </dt>
                        <dd className="mt-1 font-semibold dark:text-gray-100">
                          {draft.items.length} items
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase text-gray-500">
                          Required
                        </dt>
                        <dd className="mt-1 font-semibold dark:text-gray-100">
                          {draft.items.filter((item) => item.required).length}{" "}
                          items
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-100">
                    <strong>Record safety:</strong> saving this form changes
                    future instructor checks only. Completed records retain the
                    checklist and evidence already submitted.
                  </div>
                </div>
              )}
            </div>
            <footer className="flex flex-wrap justify-between gap-3 border-t border-gray-200 bg-white p-4 dark:border-[#2c3440] dark:bg-[#171a21]">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="min-h-10 rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold dark:border-[#39414d]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save form
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
