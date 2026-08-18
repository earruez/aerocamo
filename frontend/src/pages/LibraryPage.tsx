import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  BookOpen, Plus, Search, ChevronDown, Trash2, Edit3, Loader2,
  X, AlertCircle, Server, Code, Clock, ListChecks, Check
} from 'lucide-react';
import { libraryApi, type MaintenanceTemplate, type MaintenanceTemplateTask } from '@api/library.api';
import { componentChapterLabel, isComponentChapterTask } from '@/shared/componentChapterRules';

// ─── Template Card Component ────────────────────────────────────────────────────

interface TemplateCardProps {
  template: MaintenanceTemplate;
  categoryLabel: string;
  onEdit: (template: MaintenanceTemplate) => void;
  onDelete: (templateId: string) => void;
  isDeleting: boolean;
}

function TemplateCard({ template, categoryLabel, onEdit, onDelete, isDeleting }: TemplateCardProps) {
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
            onClick={() => onEdit(template)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            title="Edit template"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={() => onDelete(template.id)}
            disabled={isDeleting}
            className="p-2 rounded-lg hover:bg-rose-50 text-rose-500 hover:text-rose-700 transition-colors disabled:opacity-50"
            title="Delete template"
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
  const tasks = template.tasks ?? [];

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
              {task.isMandatory && (
                <div className="bg-rose-50 text-rose-700 px-2 py-1 rounded text-[10px] font-bold shrink-0">
                  OBLIGATORIA
                </div>
              )}
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
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto max-h-[calc(100vh-200px)] px-6 py-4">
            {tasks.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <ListChecks size={32} className="mx-auto mb-2 opacity-50" />
                <p>No hay tareas en esta plantilla</p>
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
    </div>
  );
}

// ─── Main Library Page ─────────────────────────────────────────────────────────

export default function LibraryPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'manufacturer' | 'dgac' | 'motor' | 'easa'>('manufacturer');
  const [selectedTemplate, setSelectedTemplate] = useState<MaintenanceTemplate | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['library-templates'],
    queryFn: libraryApi.findAll,
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

  const tabConfig: Array<{ key: 'manufacturer' | 'dgac' | 'motor' | 'easa'; label: string }> = [
    { key: 'manufacturer', label: 'Normativa de fabricante' },
    { key: 'dgac', label: 'Normativa nacional (DGAC)' },
    { key: 'motor', label: 'Componentes e inspecciones de motor' },
    { key: 'easa', label: 'Normativa pais de origen (EASA)' },
  ];

  const activeTabLabel = useMemo(() => {
    return tabConfig.find((tab) => tab.key === activeTab)?.label ?? '';
  }, [activeTab]);

  // Las plantillas de DGAC/Motor/normativa país de origen usan esos nombres reservados
  // como "manufacturer" para clasificarse. Cualquier otro fabricante real (EUROCOPTER,
  // ROBINSON, BELL, etc.) cae en "Normativa de fabricante".
  const RESERVED_CATEGORY_MANUFACTURERS = ['DGAC', 'MOTOR', 'EASA'];

  const templatesByTab = useMemo(() => {
    return templates.filter((template) => {
      const manufacturerUpper = template.manufacturer.toUpperCase();
      if (activeTab === 'manufacturer') return !RESERVED_CATEGORY_MANUFACTURERS.includes(manufacturerUpper);
      if (activeTab === 'dgac') return manufacturerUpper === 'DGAC';
      if (activeTab === 'motor') return manufacturerUpper === 'MOTOR';
      if (activeTab === 'easa') return manufacturerUpper === 'EASA';
      return true;
    });
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
              onEdit={setSelectedTemplate}
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
          onClose={() => setSelectedTemplate(null)}
        />
      )}
    </div>
  );
}
