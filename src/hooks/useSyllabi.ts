import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { TrainingTemplate, TrainingTemplateItem, Syllabus, SyllabusItem, StudentSyllabus, SyllabusCategory } from '../types';

export function useTrainingTemplates() {
  const [templates, setTemplates] = useState<TrainingTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('training_templates')
        .select(`
          *,
          items:training_template_items(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const createTemplate = async (
    template: Omit<TrainingTemplate, 'id' | 'createdAt'>,
    items: Omit<TrainingTemplateItem, 'id' | 'templateId'>[]
  ) => {
    const { data: newTemplate, error: templateError } = await supabase
      .from('training_templates')
      .insert(template)
      .select()
      .single();

    if (templateError) throw templateError;

    const itemsWithTemplateId = items.map(item => ({
      ...item,
      template_id: newTemplate.id
    }));

    const { error: itemsError } = await supabase
      .from('training_template_items')
      .insert(itemsWithTemplateId);

    if (itemsError) throw itemsError;

    await fetchTemplates();
  };

  const updateTemplate = async (id: string, updates: Partial<TrainingTemplate>) => {
    const { error } = await supabase
      .from('training_templates')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
    await fetchTemplates();
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase
      .from('training_templates')
      .delete()
      .eq('id', id);

    if (error) throw error;
    await fetchTemplates();
  };

  return { templates, loading, createTemplate, updateTemplate, deleteTemplate, refetch: fetchTemplates };
}

export function useSyllabi() {
  const [syllabi, setSyllabi] = useState<Syllabus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSyllabi = async () => {
    try {
      const { data, error } = await supabase
        .from('syllabi')
        .select(`
          *,
          template:training_templates(*),
          items:syllabus_items(
            *,
            templateItem:training_template_items(*)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSyllabi(data || []);
    } catch (err) {
      console.error('Error fetching syllabi:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSyllabi();
  }, []);

  const createSyllabusFromTemplate = async (
    name: string,
    category: SyllabusCategory,
    version: string,
    templateId: string
  ) => {
    const { data: syllabus, error: syllabusError } = await supabase
      .from('syllabi')
      .insert({
        name,
        category,
        version,
        template_id: templateId,
        active: true
      })
      .select()
      .single();

    if (syllabusError) throw syllabusError;

    const { data: templateItems, error: itemsError } = await supabase
      .from('training_template_items')
      .select('*')
      .eq('template_id', templateId)
      .order('order');

    if (itemsError) throw itemsError;

    const syllabusItems = templateItems.map(item => ({
      syllabus_id: syllabus.id,
      template_item_id: item.id,
      order: item.order
    }));

    const { error: insertError } = await supabase
      .from('syllabus_items')
      .insert(syllabusItems);

    if (insertError) throw insertError;

    await fetchSyllabi();
  };

  return { syllabi, loading, createSyllabusFromTemplate, refetch: fetchSyllabi };
}

export function useStudentSyllabi(studentId: string) {
  const [studentSyllabi, setStudentSyllabi] = useState<StudentSyllabus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStudentSyllabi = async () => {
    try {
      const { data, error } = await supabase
        .from('student_syllabi')
        .select(`
          *,
          syllabus:syllabi(
            *,
            items:syllabus_items(
              *,
              templateItem:training_template_items(*)
            )
          )
        `)
        .eq('student_id', studentId)
        .order('assigned_at', { ascending: false });

      if (error) throw error;
      setStudentSyllabi(data || []);
    } catch (err) {
      console.error('Error fetching student syllabi:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (studentId) {
      fetchStudentSyllabi();
    }
  }, [studentId]);

  const assignSyllabus = async (studentId: string, syllabusId: string, assignedBy: string) => {
    const { error } = await supabase
      .from('student_syllabi')
      .insert({
        student_id: studentId,
        syllabus_id: syllabusId,
        assigned_by: assignedBy,
        status: 'active'
      });

    if (error) throw error;
    await fetchStudentSyllabi();
  };

  return { studentSyllabi, loading, assignSyllabus, refetch: fetchStudentSyllabi };
}
