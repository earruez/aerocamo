import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  BookOpen, Plus, Search, ChevronDown, Trash2, Edit3, Loader2,
  X, AlertCircle, Server, Code, Clock, ListChecks, Check, Settings2
} from 'lucide-react';
import {
  libraryApi,
  templateMatchesCategory,
  type AssignedPlanCategory,
  type CreateTemplateInput,
  type MaintenanceTemplate,
  type MaintenanceTemplateTask,
  type CreateTemplateTaskInput,
} from '@api/library.api';
import { componentChapterLabel, isComponentChapterTask } from '@/shared/componentChapterRules';

// ─── Task form (agregar / editar) ───────────────────────────────────────────────

const INTERVAL_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'FLIGHT_HOURS', label: 'Horas de vuelo' },
  { value: 'CYCLES', label: 'Ciclos' },
  { value: 'CALENDAR_DAYS', label: 'Días calendario' },
  { value: 'FLIGHT_HOURS_OR_CALENDAR', label: 'Horas o calendario (lo que ocurra primero)' },
  { value: 'CYCLES_OR_CALENDAR', label: 'Ciclos o calendario (lo que ocurra primero)' },
  { value: 'ON_CONDITION', label: 'Según condición' },
];

const REFERENCE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'AMM', label: 'AMM — Manual de mantenimiento' },
  { value: 'AD', label: 'AD — Directiva de aeronavegabilidad' },
  { value: 'SB', label: 'SB — Boletín de servicio' },
  { value: 'CMR', label: 'CMR — Requisito de mantenimiento certificado' },
  { value: 'CDCCL', label: 'CDCCL' },
  { value: 'MPD', label: 'MPD — Documento de planificación' },
  { value: 'ETOPS', label: 'ETOPS' },
  { value: 'INTERNAL', label: 'Interno' },
];

interface TaskFormValues {
  code: string;
  title: string;
  description: string;
  chapter: string;
  section: string;
  intervalType: string;
  intervalHours: string;
  intervalCycles: string;
  intervalCalendarDays: string;
  intervalCalendarMonths: string;
  referenceNumber: string;
  referenceType: string;
  isMandatory: boolean;
  requiresInspection: boolean;
}

const EMPTY_TASK_FORM: TaskFormValues = {
  code: '',
  title: '',
  description: '',
  chapter: '',
  section: '',
  intervalType: 'FLIGHT_HOURS_OR_CALENDAR',
  intervalHours: '',
  intervalCycles: '',
  intervalCalendarDays: '',
  intervalCalendarMonths: '',
  referenceNumber: '',
  referenceType: 'AMM',
  isMandatory: false,
  requiresInspection: false,
};

function taskToFormValues(task: MaintenanceTemplateTask): TaskFormValues {
  return {
    code: task.code,
    title: task.title,
    description: task.description,
    chapter: task.chapter ?? '',
    section: task.section ?? '',
    intervalType: task.intervalType,
    intervalHours: task.intervalHours != null ? String(task.intervalHours) : '',
    intervalCycles: task.intervalCycles != null ? String(task.intervalCycles) : '',
    intervalCalendarDays: task.intervalCalendarDays != null ? String(task.intervalCalendarDays) : '',
    intervalCalendarMonths: task.intervalCalendarMonths != null ? String(task.intervalCalendarMonths) : '',
    referenceNumber: task.referenceNumber ?? '',
    referenceType: task.referenceType ?? 'AMM',
    isMandatory: task.isMandatory ?? false,
    requiresInspection: task.requiresInspection ?? false,
  };
}

function formValuesToInput(values: TaskFormValues): CreateTemplateTaskInput {
  return {
    code: values.code.trim(),
    title: values.title.trim(),
    description: values.description.trim(),
    chapter: values.chapter.trim() || undefined,
    section: values.section.trim() || undefined,
    intervalType: values.intervalType,
    intervalHours: values.intervalHours !== '' ? Number(values.intervalHours) : undefined,
    intervalCycles: values.intervalCycles !== '' ? Number(values.intervalCycles) : undefined,
    intervalCalendarDays: values.intervalCalendarDays !== '' ? Number(values.intervalCalendarDays) : undefined,
    intervalCalendarMonths: values.intervalCalendarMonths !== '' ? Number(values.intervalCalendarMonths) : undefined,
    referenceNumber: values.referenceNumber.trim() || undefined,
    referenceType: values.referenceType,
    isMandatory: values.isMandatory,
    requiresInspection: values.requiresInspection,
  };
}

function TaskFormModal({
  isNew,
  initial,
  isSaving,
  onSave,
  onClose,
}: {
  isNew: boolean;
  initial: TaskFormValues;
  isSaving: boolean;
  onSave: (values: TaskFormValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<TaskFormValues>(initial);
  const set = <K extends keyof TaskFormValues>(field: K, value: TaskFormValues[K]) =>
    setValues((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.code.trim() || !values.title.trim() || !values.description.trim()) {
      toast.error('Código, título y descripción son obligatorios');
      return;
    }
    onSave(values);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">{isNew ? 'Nueva tarea' : 'Editar tarea'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Código <span className="text-rose-500">*</span></label>
              <input
                value={values.code}
                onChange={(e) => set('code', e.target.value)}
                className="filter-input w-full"
                placeholder="DGAC-001"
              />
            </div>
            <div>
              <label className="form-label">Capítulo</label>
              <input
                value={values.chapter}
                onChange={(e) => set('chapter', e.target.value)}
                className="filter-input w-full"
                placeholder="05"
              />
            </div>
          </div>

          <div>
            <label className="form-label">Título <span className="text-rose-500">*</span></label>
            <input value={values.title} onChange={(e) => set('title', e.target.value)} className="filter-input w-full" />
          </div>

          <div>
            <label className="form-label">Descripción <span className="text-rose-500">*</span></label>
            <textarea
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              className="filter-input w-full"
              rows={3}
            />
          </div>

          <div>
            <label className="form-label">Sección</label>
            <input value={values.section} onChange={(e) => set('section', e.target.value)} className="filter-input w-full" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Tipo de intervalo</label>
              <select
                value={values.intervalType}
                onChange={(e) => set('intervalType', e.target.value)}
                className="filter-input w-full"
              >
                {INTERVAL_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Tipo de referencia</label>
              <select
                value={values.referenceType}
                onChange={(e) => set('referenceType', e.target.value)}
                className="filter-input w-full"
              >
                {REFERENCE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Horas</label>
              <input
                type="number" min={0}
                value={values.intervalHours}
                onChange={(e) => set('intervalHours', e.target.value)}
                className="filter-input w-full"
                placeholder="100"
              />
            </div>
            <div>
              <label className="form-label">Ciclos</label>
              <input
                type="number" min={0}
                value={values.intervalCycles}
                onChange={(e) => set('intervalCycles', e.target.value)}
                className="filter-input w-full"
              />
            </div>
            <div>
              <label className="form-label">Días calendario</label>
              <input
                type="number" min={0}
                value={values.intervalCalendarDays}
                onChange={(e) => set('intervalCalendarDays', e.target.value)}
                className="filter-input w-full"
              />
            </div>
            <div>
              <label className="form-label">Meses calendario</label>
              <input
                type="number" min={0}
                value={values.intervalCalendarMonths}
                onChange={(e) => set('intervalCalendarMonths', e.target.value)}
                className="filter-input w-full"
                placeholder="12"
              />
            </div>
          </div>

          <div>
            <label className="form-label">N° de referencia</label>
            <input
              value={values.referenceNumber}
              onChange={(e) => set('referenceNumber', e.target.value)}
              className="filter-input w-full"
              placeholder="AD-2024-05, SB-123, etc."
            />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={values.isMandatory}
                onChange={(e) => set('isMandatory', e.target.checked)}
                className="rounded border-slate-300"
              />
              Obligatoria
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={values.requiresInspection}
                onChange={(e) => set('requiresInspection', e.target.checked)}
                className="rounded border-slate-300"
              />
              Requiere inspección
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={isSaving} className="btn-primary flex items-center gap-1.5">
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Editar fabricante / modelo de plantilla ────────────────────────────────────

function EditTemplateMetaModal({
  template, isSaving, onSave, onClose,
}: {
  template: MaintenanceTemplate;
  isSaving: boolean;
  onSave: (input: Partial<CreateTemplateInput>) => void;
  onClose: () => void;
}) {
  const [manufacturer, setManufacturer] = useState(template.manufacturer);
  const [model, setModel] = useState(template.model);
  const [description, setDescription] = useState(template.description ?? '');
  const [version, setVersion] = useState(template.version);

  const canSubmit = manufacturer.trim() && model.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">Editar plantilla</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            Cambiar el fabricante puede mover esta plantilla a otra categoría (ej. de "Normativa de fabricante" a
            "Normativa país de origen" si escribes "EASA" o "FAA"). Las tareas de la plantilla no se ven afectadas.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Fabricante <span className="text-rose-500">*</span></label>
              <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className="filter-input w-full" autoFocus />
            </div>
            <div>
              <label className="form-label">Modelo <span className="text-rose-500">*</span></label>
              <input value={model} onChange={(e) => setModel(e.target.value)} className="filter-input w-full" />
            </div>
          </div>
          <div>
            <label className="form-label">Descripción</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="filter-input w-full" />
          </div>
          <div>
            <label className="form-label">Versión</label>
            <input value={version} onChange={(e) => setVersion(e.target.value)} className="filter-input w-full" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-6">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            type="button"
            disabled={isSaving || !canSubmit}
            onClick={() => onSave({ manufacturer: manufacturer.trim(), model: model.trim(), description: description.trim(), version: version.trim() })}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-40"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Template Card Component ────────────────────────────────────────────────────

interface TemplateCardProps {
  template: MaintenanceTemplate;
  categoryLabel: string;
  onEdit: (template: MaintenanceTemplate) => void;
  onEditMeta: (template: MaintenanceTemplate) => void;
  onDelete: (templateId: string) => void;
  isDeleting: boolean;
}

function TemplateCard({ template, categoryLabel, onEdit, onEditMeta, onDelete, isDeleting }: TemplateCardProps) {
  const taskCount = template.tasks?.length ?? 0;
  
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
            {categoryLabel}
          </p>
          <h3 className="text-xl font-bold text-slate-900 mt-1">{template.model}</h3>
          <p className="text-xs text-slate-400 mt-1">
            Fuente: {template.manufacturer}
          </p>
          {template.description && (
            <p className="text-sm text-slate-600 mt-2">{template.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onEditMeta(template)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            title="Editar fabricante / modelo"
          >
            <Settings2 size={16} />
          </button>
          <button
            onClick={() => onEdit(template)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            title="Ver / editar tareas"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={() => onDelete(template.id)}
            disabled={isDeleting}
            className="p-2 rounded-lg hover:bg-rose-50 text-rose-500 hover:text-rose-700 transition-colors disabled:opacity-50"
            title="Eliminar plantilla"
          >
            {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        </div>
      </div>

      {/* Versión y tareas */}
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100">
        <div className="text-center">
          <p className="text-2xl font-bold text-slate-700">{taskCount}</p>
          <p className="text-xs text-slate-400 font-medium">Tareas</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-mono text-slate-600">{template.version}</p>
          <p className="text-xs text-slate-400 font-medium">Versión</p>
        </div>
        <div className="text-center">
          <p className={`text-sm font-semibold ${template.isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
            {template.isActive ? 'Activo' : 'Inactivo'}
          </p>
          <p className="text-xs text-slate-400 font-medium">Estado</p>
        </div>
      </div>
    </div>
  );
}

// ─── Task Details Modal ────────────────────────────────────────────────────────

interface TaskDetailsModalProps {
  template: MaintenanceTemplate;
  onClose: () => void;
}

function TaskDetailsModal({ template, onClose }: TaskDetailsModalProps) {
  const qc = useQueryClient();
  const tasks = template.tasks ?? [];
  const [editingTask, setEditingTask] = useState<MaintenanceTemplateTask | 'new' | null>(null);

  const addTaskMutation = useMutation({
    mutationFn: (input: CreateTemplateTaskInput) => libraryApi.addTask(template.id, input),
    onSuccess: () => {
      toast.success('Tarea agregada');
      qc.invalidateQueries({ queryKey: ['library-templates'] });
      setEditingTask(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al agregar la tarea';
      toast.error(msg);
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: CreateTemplateTaskInput }) => libraryApi.updateTask(taskId, input),
    onSuccess: () => {
      toast.success('Tarea actualizada');
      qc.invalidateQueries({ queryKey: ['library-templates'] });
      setEditingTask(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al actualizar la tarea';
      toast.error(msg);
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => libraryApi.deleteTask(taskId),
    onSuccess: () => {
      toast.success('Tarea eliminada');
      qc.invalidateQueries({ queryKey: ['library-templates'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al eliminar la tarea';
      toast.error(msg);
    },
  });

  const handleDelete = (task: MaintenanceTemplateTask) => {
    if (!window.confirm(`¿Eliminar la tarea ${task.code} — ${task.title}? Esta acción no se puede deshacer.`)) return;
    deleteTaskMutation.mutate(task.id);
  };

  const groupedByChapter = (source: MaintenanceTemplateTask[]) => {
    const grouped = source.reduce((acc, task) => {
      const chapter = task.chapter || 'Sin capítulo';
      if (!acc[chapter]) acc[chapter] = [];
      acc[chapter].push(task);
      return acc;
    }, {} as Record<string, MaintenanceTemplateTask[]>);

    return Object.entries(grouped).sort(([a], [b]) => {
      if (a === 'Sin capítulo') return 1;
      if (b === 'Sin capítulo') return -1;
      return a.localeCompare(b);
    });
  };

  const componentTasks = useMemo(
    () => tasks.filter((task) => isComponentChapterTask({ chapter: task.chapter, section: task.section, taskCode: task.code })),
    [tasks],
  );
  const regularTasks = useMemo(
    () => tasks.filter((task) => !isComponentChapterTask({ chapter: task.chapter, section: task.section, taskCode: task.code })),
    [tasks],
  );

  const componentByChapter = useMemo(() => groupedByChapter(componentTasks), [componentTasks]);
  const regularByChapter = useMemo(() => groupedByChapter(regularTasks), [regularTasks]);

  const renderChapterBlock = (chapter: string, chapterTasks: MaintenanceTemplateTask[]) => (
    <div key={chapter}>
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
        {chapter}
      </h3>
      <div className="space-y-2">
        {chapterTasks.map(task => (
          <div
            key={task.id}
            className="rounded-lg border border-slate-200 p-3 bg-slate-50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs font-bold text-slate-500">
                  {task.code}
                </p>
                <p className="font-semibold text-sm text-slate-800 mt-1">
                  {task.title}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  {task.description}
                </p>
                {task.section && (
                  <p className="text-[10px] text-slate-400 mt-1">Seccion: {task.section}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {task.isMandatory && (
                  <div className="bg-rose-50 text-rose-700 px-2 py-1 rounded text-[10px] font-bold">
                    OBLIGATORIA
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setEditingTask(task)}
                  className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
                  title="Editar tarea"
                >
                  <Edit3 size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(task)}
                  disabled={deleteTaskMutation.isPending}
                  className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition-colors disabled:opacity-50"
                  title="Eliminar tarea"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-200">
              {task.intervalHours && (
                <div className="text-center">
                  <p className="text-xs text-slate-500">Horas</p>
                  <p className="font-bold text-sm text-slate-700">
                    {typeof task.intervalHours === 'object'
                      ? (task.intervalHours as { toString: () => string }).toString()
                      : task.intervalHours}
                  </p>
                </div>
              )}
              {task.intervalCycles && (
                <div className="text-center">
                  <p className="text-xs text-slate-500">Ciclos</p>
                  <p className="font-bold text-sm text-slate-700">{task.intervalCycles}</p>
                </div>
              )}
              {task.intervalCalendarDays && (
                <div className="text-center">
                  <p className="text-xs text-slate-500">Dias</p>
                  <p className="font-bold text-sm text-slate-700">
                    {task.intervalCalendarDays}
                  </p>
                </div>
              )}
              {task.intervalCalendarMonths && (
                <div className="text-center">
                  <p className="text-xs text-slate-500">Meses</p>
                  <p className="font-bold text-sm text-slate-700">
                    {task.intervalCalendarMonths}
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      
      <div className="relative flex items-start justify-center min-h-full p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {template.manufacturer} {template.model}
              </h2>
              <p className="text-sm text-slate-500">{tasks.length} tareas configuradas</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditingTask('new')}
                className="btn-primary flex items-center gap-1.5 text-xs"
              >
                <Plus size={13} />
                Agregar tarea
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto max-h-[calc(100vh-200px)] px-6 py-4">
            {tasks.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <ListChecks size={32} className="mx-auto mb-2 opacity-50" />
                <p>No hay tareas en esta plantilla</p>
                <button
                  type="button"
                  onClick={() => setEditingTask('new')}
                  className="btn-primary mt-4 inline-flex items-center gap-1.5 text-xs"
                >
                  <Plus size={13} />
                  Agregar tarea
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                  <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Componentes</p>
                  <p className="text-xs text-blue-600 mt-1">
                    Secciones consideradas de componente: {componentChapterLabel}
                  </p>
                  <p className="text-xs text-blue-700 mt-1 font-semibold">
                    {componentTasks.length} tarea{componentTasks.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {componentByChapter.map(([chapter, chapterTasks]) => renderChapterBlock(chapter, chapterTasks))}

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Mantenimiento General</p>
                  <p className="text-xs text-slate-500 mt-1 font-semibold">
                    {regularTasks.length} tarea{regularTasks.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {regularByChapter.map(([chapter, chapterTasks]) => renderChapterBlock(chapter, chapterTasks))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
            <button
              onClick={onClose}
              className="btn-secondary"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>

      {editingTask && (
        <TaskFormModal
          isNew={editingTask === 'new'}
          initial={editingTask === 'new' ? EMPTY_TASK_FORM : taskToFormValues(editingTask)}
          isSaving={addTaskMutation.isPending || updateTaskMutation.isPending}
          onSave={(values) => {
            const input = formValuesToInput(values);
            if (editingTask === 'new') {
              addTaskMutation.mutate(input);
            } else {
              updateTaskMutation.mutate({ taskId: editingTask.id, input });
            }
          }}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}

// ─── Main Library Page ─────────────────────────────────────────────────────────

export default function LibraryPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'manufacturer' | 'dgac' | 'motor' | 'easa'>('manufacturer');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [editingMetaTemplateId, setEditingMetaTemplateId] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['library-templates'],
    queryFn: libraryApi.findAll,
  });

  // Se deriva del listado en vez de guardar una copia: así el modal de tareas
  // refleja de inmediato los cambios (agregar/editar/eliminar tarea) sin cerrar
  // y volver a abrir.
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );
  const editingMetaTemplate = useMemo(
    () => templates.find((t) => t.id === editingMetaTemplateId) ?? null,
    [templates, editingMetaTemplateId],
  );

  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreateTemplateInput> }) => libraryApi.update(id, input),
    onSuccess: () => {
      toast.success('Plantilla actualizada');
      qc.invalidateQueries({ queryKey: ['library-templates'] });
      setEditingMetaTemplateId(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al actualizar';
      toast.error(msg);
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: string) => libraryApi.deleteTemplate(id),
    onSuccess: () => {
      toast.success('Plantilla eliminada');
      qc.invalidateQueries({ queryKey: ['library-templates'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al eliminar';
      toast.error(msg);
    },
  });

  const tabConfig: Array<{ key: 'manufacturer' | 'dgac' | 'motor' | 'easa'; label: string; category: AssignedPlanCategory }> = [
    { key: 'manufacturer', label: 'Normativa de fabricante', category: 'manufacturer' },
    { key: 'dgac', label: 'Normativa nacional (DGAC)', category: 'national_dgac' },
    { key: 'motor', label: 'Componentes e inspecciones de motor', category: 'engine_components' },
    { key: 'easa', label: 'Normativa país de origen (EASA / FAA)', category: 'origin_country' },
  ];

  const activeTabLabel = useMemo(() => {
    return tabConfig.find((tab) => tab.key === activeTab)?.label ?? '';
  }, [activeTab]);

  // Las plantillas de DGAC/Motor/normativa país de origen usan nombres reservados
  // como "manufacturer" para clasificarse (ver templateMatchesCategory). Cualquier
  // otro fabricante real (EUROCOPTER, ROBINSON, BELL, etc.) cae en "Normativa de
  // fabricante".
  const templatesByTab = useMemo(() => {
    const category = tabConfig.find((tab) => tab.key === activeTab)?.category;
    if (!category) return templates;
    return templates.filter((template) => templateMatchesCategory(template, category));
  }, [templates, activeTab]);

  // Filter templates
  const filtered = useMemo(() => {
    if (!search) return templatesByTab;
    const q = search.toLowerCase();
    return templatesByTab.filter(t =>
      t.manufacturer.toLowerCase().includes(q) ||
      t.model.toLowerCase().includes(q)
    );
  }, [templatesByTab, search]);

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
            <BookOpen size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Biblioteca de Mantenimiento</h1>
            <p className="text-sm text-slate-500">Plantillas reutilizables por marca y modelo</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-wrap gap-2">
        {tabConfig.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                isActive
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="filter-bar">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por marca o modelo…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="filter-input pl-8 flex-1"
          />
        </div>
        {search && (
          <button
            onClick={() => setSearch('')}
            className="text-xs text-brand-600 hover:text-brand-700 font-semibold transition-colors"
          >
            Limpiar
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {filtered.length} plantilla{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 size={22} className="animate-spin mr-2" />
          Cargando plantillas…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Server size={32} className="text-slate-300" />
          <p className="text-slate-500 font-medium">
            {search ? 'No se encontraron plantillas' : 'No hay plantillas disponibles'}
          </p>
          <p className="text-sm text-slate-400">
            {search 
              ? 'Intenta con otro término de búsqueda'
              : 'No hay plantillas cargadas en esta pestana'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(template => (
            <TemplateCard
              key={template.id}
              template={template}
              categoryLabel={activeTabLabel}
              onEdit={(t) => setSelectedTemplateId(t.id)}
              onEditMeta={(t) => setEditingMetaTemplateId(t.id)}
              onDelete={id => deleteTemplateMutation.mutate(id)}
              isDeleting={deleteTemplateMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Task Details Modal */}
      {selectedTemplate && (
        <TaskDetailsModal
          template={selectedTemplate}
          onClose={() => setSelectedTemplateId(null)}
        />
      )}

      {editingMetaTemplate && (
        <EditTemplateMetaModal
          template={editingMetaTemplate}
          isSaving={updateTemplateMutation.isPending}
          onSave={(input) => updateTemplateMutation.mutate({ id: editingMetaTemplate.id, input })}
          onClose={() => setEditingMetaTemplateId(null)}
        />
      )}
    </div>
  );
}
