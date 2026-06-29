import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { logNABHEvidence } from '@/lib/nabh-evidence';
import { useHospitalId } from '@/hooks/useHospitalId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { GraduationCap, CheckCircle2, AlertTriangle, XCircle, Clock, Download, Printer, Send, Users, Plus, BookOpen, Loader2 } from 'lucide-react';
import { format, addMonths, differenceInDays, isPast, isBefore, addDays } from 'date-fns';

interface Course {
  id: string;
  course_name: string;
  course_code: string;
  category: string;
  description: string | null;
  duration_minutes: number;
  passing_score: number;
  validity_months: number | null;
  target_roles: string[];
  content_type: string;
  is_system_course: boolean;
}

interface Enrollment {
  id: string;
  course_id: string;
  user_id: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  score_percent: number | null;
  attempts: number;
  course?: Course;
}

interface QuizQuestion {
  id: string;
  question_text: string;
  question_type: string;
  options: { text: string; is_correct: boolean }[];
  explanation: string | null;
  marks: number;
}

interface Certificate {
  id: string;
  certificate_number: string;
  issued_at: string;
  expires_at: string | null;
  course_id: string;
  enrollment_id: string;
}

interface StaffUser {
  id: string;
  full_name: string;
  role: string;
  department_id: string | null;
}

const categoryColors: Record<string, string> = {
  mandatory_annual: 'bg-red-100 text-red-800',
  mandatory_biannual: 'bg-orange-100 text-orange-800',
  mandatory_once: 'bg-blue-100 text-blue-800',
  clinical: 'bg-teal-100 text-teal-800',
  administrative: 'bg-gray-100 text-gray-800',
  safety: 'bg-yellow-100 text-yellow-800',
  compliance: 'bg-purple-100 text-purple-800',
  custom: 'bg-indigo-100 text-indigo-800',
};

export default function LMSPage() {
  const { hospitalId, loading: hospitalLoading } = useHospitalId();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = searchParams.get('admin') === 'true';


  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState('Staff');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  // Quiz state
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizCourse, setQuizCourse] = useState<Course | null>(null);
  const [quizEnrollment, setQuizEnrollment] = useState<Enrollment | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizStep, setQuizStep] = useState<'intro' | 'quiz' | 'results'>('intro');
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [quizResult, setQuizResult] = useState<{ score: number; passed: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Certificate modal
  const [certOpen, setCertOpen] = useState(false);
  const [certData, setCertData] = useState<{ course: Course; cert: Certificate; userName: string; userRole: string } | null>(null);

  // Admin modals
  const [bulkEnrolOpen, setBulkEnrolOpen] = useState(false);
  const [addCourseOpen, setAddCourseOpen] = useState(false);
  const [addQuestionsOpen, setAddQuestionsOpen] = useState(false);
  const [cellDetailOpen, setCellDetailOpen] = useState(false);
  const [cellDetail, setCellDetail] = useState<{ deptName: string; courseName: string; staff: any[] } | null>(null);

  // Bulk enrol form
  const [bulkCourseId, setBulkCourseId] = useState('');
  const [bulkMode, setBulkMode] = useState<'all' | 'role' | 'department'>('all');
  const [bulkRole, setBulkRole] = useState('');
  const [bulkDept, setBulkDept] = useState('');
  const [bulkDueDate, setBulkDueDate] = useState('');

  // Add course form
  const [newCourse, setNewCourse] = useState({
    course_name: '', category: 'custom', duration_minutes: 30,
    passing_score: 80, validity_months: 12, target_roles: '',
    description: '',
  });

  // Add questions
  const [questionCourseId, setQuestionCourseId] = useState('');
  const [newQuestion, setNewQuestion] = useState({
    question_text: '', question_type: 'mcq',
    options: [
      { text: '', is_correct: true },
      { text: '', is_correct: false },
      { text: '', is_correct: false },
      { text: '', is_correct: false },
    ],
    explanation: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;

    const [coursesRes, usersRes, deptsRes] = await Promise.all([
      supabase.from('lms_courses').select('*').eq('is_active', true),
      supabase.from('users').select('id, full_name, role, department_id').eq('hospital_id', hospitalId),
      supabase.from('departments').select('id, name').eq('hospital_id', hospitalId),
    ]);

    setCourses((coursesRes.data || []) as Course[]);
    setStaffUsers(usersRes.data || []);
    setDepartments(deptsRes.data || []);

    if (userId) {
      const userRow = (usersRes.data || []).find((u: any) => u.id === userId);
      if (userRow) {
        setCurrentUserId(userRow.id);
        setCurrentUserName(userRow.full_name || 'Staff');
      }
    }

    const [enrollRes, certRes] = await Promise.all([
      supabase.from('lms_enrollments').select('*').eq('hospital_id', hospitalId),
      supabase.from('lms_certificates').select('*').eq('hospital_id', hospitalId),
    ]);

    setEnrollments(enrollRes.data || []);
    setCertificates((certRes.data || []) as Certificate[]);
    setLoading(false);
  };

  // Derived data for my view
  const myEnrollments = useMemo(() => {
    if (!currentUserId) return [];
    return enrollments
      .filter(e => e.user_id === currentUserId)
      .map(e => ({ ...e, course: courses.find(c => c.id === e.course_id) }));
  }, [enrollments, courses, currentUserId]);

  const stats = useMemo(() => {
    const completed = myEnrollments.filter(e => e.status === 'completed').length;
    const dueSoon = myEnrollments.filter(e =>
      e.status !== 'completed' && e.due_date &&
      differenceInDays(new Date(e.due_date), new Date()) <= 30 &&
      differenceInDays(new Date(e.due_date), new Date()) >= 0
    ).length;
    const overdue = myEnrollments.filter(e =>
      (e.status !== 'completed' && e.due_date && isPast(new Date(e.due_date))) ||
      e.status === 'expired'
    ).length;
    return { completed, dueSoon, overdue };
  }, [myEnrollments]);

  const filteredEnrollments = useMemo(() => {
    if (filter === 'all') return myEnrollments;
    if (filter === 'pending') return myEnrollments.filter(e => ['enrolled', 'in_progress'].includes(e.status));
    if (filter === 'completed') return myEnrollments.filter(e => e.status === 'completed');
    if (filter === 'expired') return myEnrollments.filter(e => e.status === 'expired' || e.status === 'failed');
    return myEnrollments;
  }, [myEnrollments, filter]);

  const getEnrollmentStatus = (e: Enrollment) => {
    if (e.status === 'completed') return 'completed';
    if (e.status === 'expired') return 'expired';
    if (e.status === 'failed') return 'failed';
    if (e.due_date && isPast(new Date(e.due_date))) return 'overdue';
    if (e.due_date && differenceInDays(new Date(e.due_date), new Date()) <= 30) return 'due_soon';
    return 'pending';
  };

  // ── QUIZ ENGINE ──
  const startQuiz = async (enrollment: Enrollment, course: Course) => {
    if (enrollment.attempts >= 3 && enrollment.status !== 'completed') {
      toast.error('Maximum attempts reached. Contact your supervisor.');
      return;
    }
    const { data: questions } = await supabase
      .from('lms_quiz_questions')
      .select('*')
      .eq('course_id', course.id);

    if (!questions || questions.length === 0) {
      toast.error('No quiz questions available for this course yet.');
      return;
    }

    setQuizCourse(course);
    setQuizEnrollment(enrollment);
    setQuizQuestions(questions as unknown as QuizQuestion[]);
    setQuizStep('intro');
    setCurrentQ(0);
    setAnswers({});
    setQuizResult(null);
    setQuizOpen(true);
  };

  const submitQuiz = async () => {
    if (!quizEnrollment || !quizCourse) return;
    setSubmitting(true);

    let totalMarks = 0;
    let earnedMarks = 0;
    const answerLog: any[] = [];

    quizQuestions.forEach(q => {
      totalMarks += q.marks;
      const selectedIdx = answers[q.id];
      const isCorrect = selectedIdx !== undefined && q.options[selectedIdx]?.is_correct;
      if (isCorrect) earnedMarks += q.marks;
      answerLog.push({
        question_id: q.id,
        selected_option: selectedIdx ?? -1,
        is_correct: !!isCorrect,
      });
    });

    const scorePercent = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;
    const passed = scorePercent >= quizCourse.passing_score;

    // Insert quiz attempt
    await supabase.from('lms_quiz_attempts').insert({
      enrollment_id: quizEnrollment.id,
      attempt_number: quizEnrollment.attempts + 1,
      completed_at: new Date().toISOString(),
      score_percent: scorePercent,
      answers: answerLog,
      passed,
    });

    // Update enrollment
    const updates: any = {
      attempts: quizEnrollment.attempts + 1,
      last_attempt_at: new Date().toISOString(),
      score_percent: scorePercent,
    };

    if (passed) {
      updates.status = 'completed';
      updates.completed_at = new Date().toISOString();

      // Generate certificate
      const certNum = `CERT-HMS-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const expiresAt = quizCourse.validity_months
        ? format(addMonths(new Date(), quizCourse.validity_months), 'yyyy-MM-dd')
        : null;

      await supabase.from('lms_certificates').insert({
        hospital_id: hospitalId,
        user_id: quizEnrollment.user_id,
        course_id: quizCourse.id,
        enrollment_id: quizEnrollment.id,
        certificate_number: certNum,
        expires_at: expiresAt,
      });

      const staffUser = staffUsers.find(u => u.id === quizEnrollment.user_id);
      logNABHEvidence(hospitalId, "HRM.6",
        `Training completed: ${staffUser?.full_name || "Staff"}, Course: ${quizCourse.course_name}, Score: ${scorePercent}%, Certificate: ${certNum}`);
    } else if (quizEnrollment.attempts + 1 >= 3) {
      updates.status = 'failed';
    } else {
      updates.status = 'in_progress';
    }

    await supabase.from('lms_enrollments').update(updates).eq('id', quizEnrollment.id);

    setQuizResult({ score: scorePercent, passed });
    setQuizStep('results');
    setSubmitting(false);
    loadData();
  };

  // ── CERTIFICATE ──
  const openCertificate = (enrollment: Enrollment) => {
    const course = courses.find(c => c.id === enrollment.course_id);
    const cert = certificates.find(c => c.enrollment_id === enrollment.id);
    if (!course || !cert) { toast.error('Certificate not found'); return; }
    const user = staffUsers.find(u => u.id === enrollment.user_id);
    setCertData({
      course,
      cert,
      userName: user?.full_name || currentUserName,
      userRole: user?.role || '',
    });
    setCertOpen(true);
  };

  const printCertificate = () => {
    const el = document.getElementById('certificate-content');
    if (!el) return;
    const w = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
    if (!w) return;
    w.document.write(`<html><head><title>Certificate</title>
      <style>
        @page { size: A4 landscape; margin: 0; }
        body { margin: 0; font-family: 'Georgia', serif; }
        .cert { width: 297mm; height: 210mm; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 12px double #B8860B; padding: 40px; box-sizing: border-box; }
        .cert h1 { color: #B8860B; font-size: 28px; letter-spacing: 4px; margin: 0; }
        .cert .name { color: #1A2F5A; font-size: 32px; font-weight: bold; margin: 16px 0; }
        .cert .course-name { color: #1A2F5A; font-size: 22px; font-weight: bold; }
        .cert .detail { color: #333; font-size: 14px; margin: 4px 0; }
        .cert .footer { position: absolute; bottom: 30px; width: calc(100% - 80px); display: flex; justify-content: space-between; font-size: 12px; color: #666; }
        .cert .nabh { color: #0E7B7B; font-weight: bold; }
      </style></head><body>`);
    w.document.write(el.outerHTML);
    w.document.write('</body></html>');
    w.document.close();
    w.print();
  };

  // ── ADMIN: BULK ENROL ──
  const handleBulkEnrol = async () => {
    if (!bulkCourseId) { toast.error('Select a course'); return; }

    let targetStaff = staffUsers;
    if (bulkMode === 'role' && bulkRole) {
      targetStaff = staffUsers.filter(s => s.role === bulkRole);
    } else if (bulkMode === 'department' && bulkDept) {
      targetStaff = staffUsers.filter(s => s.department_id === bulkDept);
    }

    const existing = enrollments.filter(e => e.course_id === bulkCourseId).map(e => e.user_id);
    const toEnrol = targetStaff.filter(s => !existing.includes(s.id));

    if (toEnrol.length === 0) { toast.info('All staff already enrolled'); return; }

    const rows = toEnrol.map(s => ({
      hospital_id: hospitalId,
      user_id: s.id,
      course_id: bulkCourseId,
      due_date: bulkDueDate || null,
    }));

    const { error } = await supabase.from('lms_enrollments').insert(rows);
    if (error) { toast.error('Enrol failed: ' + error.message); return; }

    toast.success(`Enrolled ${toEnrol.length} staff`);
    setBulkEnrolOpen(false);
    loadData();
  };

  // ── ADMIN: ADD COURSE ──
  const handleAddCourse = async () => {
    if (!newCourse.course_name) { toast.error('Course name required'); return; }
    const code = `CUST-${Date.now().toString(36).toUpperCase()}`;
    const { error } = await supabase.from('lms_courses').insert({
      hospital_id: hospitalId,
      course_name: newCourse.course_name,
      course_code: code,
      category: newCourse.category,
      description: newCourse.description || null,
      duration_minutes: newCourse.duration_minutes,
      passing_score: newCourse.passing_score,
      validity_months: newCourse.validity_months || null,
      target_roles: newCourse.target_roles ? newCourse.target_roles.split(',').map(r => r.trim()) : [],
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Course created');
    setAddCourseOpen(false);
    setNewCourse({ course_name: '', category: 'custom', duration_minutes: 30, passing_score: 80, validity_months: 12, target_roles: '', description: '' });
    loadData();
  };

  // ── ADMIN: ADD QUESTION ──
  const handleAddQuestion = async () => {
    if (!questionCourseId || !newQuestion.question_text) { toast.error('Fill required fields'); return; }
    const hasCorrect = newQuestion.options.some(o => o.is_correct && o.text);
    if (!hasCorrect) { toast.error('At least one correct option required'); return; }

    const opts = newQuestion.options.filter(o => o.text.trim());
    const { error } = await supabase.from('lms_quiz_questions').insert({
      course_id: questionCourseId,
      question_text: newQuestion.question_text,
      question_type: newQuestion.question_type,
      options: opts,
      explanation: newQuestion.explanation || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Question added');
    setNewQuestion({
      question_text: '', question_type: 'mcq',
      options: [{ text: '', is_correct: true }, { text: '', is_correct: false }, { text: '', is_correct: false }, { text: '', is_correct: false }],
      explanation: '',
    });
  };

  // ── ADMIN: COMPLIANCE HEATMAP ──
  const heatmapData = useMemo(() => {
    const mandatoryCourses = courses.filter(c => c.category.startsWith('mandatory'));
    return {
      courses: mandatoryCourses,
      departments: departments,
      getCell: (deptId: string, courseId: string) => {
        const deptStaff = staffUsers.filter(s => s.department_id === deptId);
        if (deptStaff.length === 0) return { pct: 0, total: 0, completed: 0 };
        const completed = deptStaff.filter(s =>
          enrollments.some(e => e.user_id === s.id && e.course_id === courseId && e.status === 'completed')
        ).length;
        return { pct: Math.round((completed / deptStaff.length) * 100), total: deptStaff.length, completed };
      },
    };
  }, [courses, departments, staffUsers, enrollments]);

  const overdueStaff = useMemo(() => {
    return enrollments
      .filter(e => e.status !== 'completed' && e.due_date && isPast(new Date(e.due_date)))
      .map(e => {
        const user = staffUsers.find(u => u.id === e.user_id);
        const course = courses.find(c => c.id === e.course_id);
        return { ...e, userName: user?.full_name || 'Unknown', courseName: course?.course_name || '', daysOverdue: differenceInDays(new Date(), new Date(e.due_date!)) };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [enrollments, staffUsers, courses]);

  const sendReminder = (staffName: string, courseName: string) => {
    const msg = encodeURIComponent(`Dear ${staffName}, your "${courseName}" training is overdue. Please log in to the HMS LMS and complete it. This is mandatory for NABH compliance.`);
    window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener,noreferrer');
    toast.success('Reminder opened in WhatsApp');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // ═════════════ RENDER ═════════════
  if (hospitalLoading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-background">
      {/* HEADER */}
      <div className="h-[52px] min-h-[52px] flex items-center justify-between px-4 border-b bg-card">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          <h1 className="text-base font-bold text-foreground">Staff Training</h1>
          {isAdmin && <Badge variant="outline" className="ml-2">Admin View</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Button variant="outline" size="sm" onClick={() => setSearchParams({})}>
              👤 Staff View
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setSearchParams({ admin: 'true' })}>
              👨‍💼 Admin View
            </Button>
          )}
        </div>
      </div>

      {/* ═════════ STAFF VIEW ═════════ */}
      {!isAdmin && (
        <>
          {/* Stats */}
          <div className="px-4 py-3 border-b bg-card">
            <p className="text-base font-bold mb-2">Hello, {currentUserName}</p>
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-3 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-xl font-bold font-mono">{stats.completed}</p>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </div>
              </Card>
              <Card className="p-3 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-xl font-bold font-mono">{stats.dueSoon}</p>
                  <p className="text-xs text-muted-foreground">Due Soon</p>
                </div>
              </Card>
              <Card className="p-3 flex items-center gap-2">
                <XCircle className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-xl font-bold font-mono">{stats.overdue}</p>
                  <p className="text-xs text-muted-foreground">Overdue</p>
                </div>
              </Card>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="px-4 py-2 border-b">
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs h-7">All</TabsTrigger>
                <TabsTrigger value="pending" className="text-xs h-7">Pending</TabsTrigger>
                <TabsTrigger value="completed" className="text-xs h-7">Completed</TabsTrigger>
                <TabsTrigger value="expired" className="text-xs h-7">Expired</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Course list */}
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
            {filteredEnrollments.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p>No courses found</p>
              </div>
            )}
            {filteredEnrollments.map(e => {
              const status = getEnrollmentStatus(e);
              const course = e.course;
              if (!course) return null;
              return (
                <Card key={e.id} className="p-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-bold truncate">{course.course_name}</p>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${categoryColors[course.category] || ''}`}>
                        {course.category.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span><Clock className="h-3 w-3 inline mr-0.5" />{course.duration_minutes} min</span>
                      {e.due_date && <span>Due: {format(new Date(e.due_date), 'dd/MM/yyyy')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    {status === 'completed' && (
                      <>
                        <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">
                          ✅ Completed {e.completed_at && format(new Date(e.completed_at), 'dd/MM/yy')}
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openCertificate(e)}>
                          <Download className="h-3 w-3 mr-1" />Certificate
                        </Button>
                      </>
                    )}
                    {status === 'due_soon' && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => startQuiz(e, course)}>
                        Start Course →
                      </Button>
                    )}
                    {status === 'overdue' && (
                      <Button size="sm" variant="destructive" className="h-7 text-xs animate-pulse" onClick={() => startQuiz(e, course)}>
                        ❌ Start Now →
                      </Button>
                    )}
                    {status === 'pending' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startQuiz(e, course)}>
                        Start Course →
                      </Button>
                    )}
                    {status === 'expired' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs border-amber-400 text-amber-700" onClick={() => startQuiz(e, course)}>
                        🔄 Renew →
                      </Button>
                    )}
                    {status === 'failed' && (
                      <Badge className="bg-red-100 text-red-800 text-[10px]">Max attempts reached</Badge>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* ═════════ ADMIN VIEW ═════════ */}
      {isAdmin && (
        <div className="flex-1 overflow-y-auto">
          {/* Admin toolbar */}
          <div className="px-4 py-2 border-b bg-card flex items-center gap-2">
            <Button size="sm" onClick={() => setBulkEnrolOpen(true)}>
              <Users className="h-3.5 w-3.5 mr-1" />Bulk Enrol
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddCourseOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add Course
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddQuestionsOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add Questions
            </Button>
          </div>

          {/* Compliance Heatmap */}
          <div className="p-4">
            <h2 className="text-sm font-bold mb-3">📊 Compliance Heatmap</h2>
            {heatmapData.departments.length > 0 && heatmapData.courses.length > 0 ? (
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="p-2 text-left font-medium w-36 sticky left-0 bg-muted/30">Department</th>
                      {heatmapData.courses.map(c => (
                        <th key={c.id} className="p-2 text-center font-medium min-w-[100px]">
                          {c.course_name.length > 20 ? c.course_name.slice(0, 18) + '…' : c.course_name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapData.departments.map(d => (
                      <tr key={d.id} className="border-b">
                        <td className="p-2 font-medium sticky left-0 bg-card">{d.name}</td>
                        {heatmapData.courses.map(c => {
                          const cell = heatmapData.getCell(d.id, c.id);
                          const bg = cell.total === 0 ? 'bg-muted/20' :
                            cell.pct >= 80 ? 'bg-emerald-100 text-emerald-800' :
                            cell.pct >= 60 ? 'bg-amber-100 text-amber-800' :
                            cell.pct > 0 ? 'bg-red-100 text-red-800' :
                            'bg-red-200 text-red-900';
                          return (
                            <td
                              key={c.id}
                              className={`p-2 text-center font-mono cursor-pointer hover:opacity-80 ${bg}`}
                              onClick={() => {
                                const deptStaff = staffUsers.filter(s => s.department_id === d.id);
                                const detail = deptStaff.map(s => {
                                  const enrol = enrollments.find(e => e.user_id === s.id && e.course_id === c.id);
                                  return { name: s.full_name, status: enrol?.status || 'not_enrolled', completed_at: enrol?.completed_at, score: enrol?.score_percent };
                                });
                                setCellDetail({ deptName: d.name, courseName: c.course_name, staff: detail });
                                setCellDetailOpen(true);
                              }}
                            >
                              {cell.total === 0 ? '—' : `${cell.pct}%`}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No departments or mandatory courses found.</p>
            )}
          </div>

          {/* Overdue Staff */}
          <div className="px-4 pb-4">
            <h2 className="text-sm font-bold mb-3">❌ Overdue Staff ({overdueStaff.length})</h2>
            {overdueStaff.length === 0 ? (
              <p className="text-sm text-muted-foreground">No overdue training. ✅</p>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="p-2 text-left font-medium">Staff</th>
                      <th className="p-2 text-left font-medium">Course</th>
                      <th className="p-2 text-left font-medium">Due Date</th>
                      <th className="p-2 text-right font-medium">Days Overdue</th>
                      <th className="p-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueStaff.slice(0, 20).map(s => (
                      <tr key={s.id} className="border-b hover:bg-muted/20">
                        <td className="p-2 font-medium">{s.userName}</td>
                        <td className="p-2">{s.courseName}</td>
                        <td className="p-2">{format(new Date(s.due_date!), 'dd/MM/yyyy')}</td>
                        <td className="p-2 text-right font-mono text-destructive">{s.daysOverdue}d</td>
                        <td className="p-2 text-right">
                          <Button variant="ghost" size="sm" className="h-6 text-[10px]"
                            onClick={() => sendReminder(s.userName, s.courseName)}>
                            <Send className="h-3 w-3 mr-1" />Remind
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ QUIZ MODAL ═══════ */}
      <Dialog open={quizOpen} onOpenChange={setQuizOpen}>
        <DialogContent className="max-w-[600px] max-h-[90vh] overflow-y-auto">
          {quizStep === 'intro' && quizCourse && (
            <>
              <DialogHeader>
                <DialogTitle>{quizCourse.course_name}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground mb-4">{quizCourse.description}</p>
              <div className="flex items-center gap-4 text-sm mb-4">
                <span><Clock className="h-4 w-4 inline mr-1" />{quizCourse.duration_minutes} min</span>
                <span>📝 {quizQuestions.length} questions</span>
                <span>🎯 Pass: {quizCourse.passing_score}%</span>
              </div>
              {quizEnrollment && quizEnrollment.attempts > 0 && (
                <p className="text-xs text-muted-foreground mb-2">Attempts used: {quizEnrollment.attempts}/3</p>
              )}
              <Button className="w-full" onClick={() => setQuizStep('quiz')}>Begin Quiz →</Button>
            </>
          )}

          {quizStep === 'quiz' && quizQuestions.length > 0 && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">Question {currentQ + 1} of {quizQuestions.length}</DialogTitle>
              </DialogHeader>
              <Progress value={((currentQ + 1) / quizQuestions.length) * 100} className="mb-4" />
              <p className="text-sm font-medium leading-relaxed mb-4">{quizQuestions[currentQ].question_text}</p>
              <div className="space-y-2">
                {quizQuestions[currentQ].options.map((opt, idx) => (
                  <button
                    key={idx}
                    className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                      answers[quizQuestions[currentQ].id] === idx
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => setAnswers(prev => ({ ...prev, [quizQuestions[currentQ].id]: idx }))}
                  >
                    {String.fromCharCode(65 + idx)}. {opt.text}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-4">
                <Button variant="outline" size="sm" disabled={currentQ === 0} onClick={() => setCurrentQ(p => p - 1)}>
                  ← Previous
                </Button>
                {currentQ < quizQuestions.length - 1 ? (
                  <Button size="sm" onClick={() => setCurrentQ(p => p + 1)}
                    disabled={answers[quizQuestions[currentQ].id] === undefined}>
                    Next →
                  </Button>
                ) : (
                  <Button size="sm" onClick={submitQuiz} disabled={submitting || answers[quizQuestions[currentQ].id] === undefined}>
                    {submitting ? 'Submitting...' : 'Submit'}
                  </Button>
                )}
              </div>
            </>
          )}

          {quizStep === 'results' && quizResult && quizCourse && (
            <div className={`text-center py-6 ${quizResult.passed ? 'bg-emerald-50' : 'bg-red-50'} rounded-lg`}>
              <p className="text-5xl font-bold font-mono mb-2">{quizResult.score}%</p>
              {quizResult.passed ? (
                <>
                  <p className="text-lg font-bold text-emerald-700 mb-1">✅ Passed!</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    You scored {quizResult.score}% — required {quizCourse.passing_score}%
                  </p>
                  <Button onClick={() => {
                    setQuizOpen(false);
                    if (quizEnrollment) openCertificate(quizEnrollment);
                  }}>
                    <Download className="h-4 w-4 mr-1" />Download Certificate
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-lg font-bold text-destructive mb-1">❌ Try Again</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    You scored {quizResult.score}% — required {quizCourse.passing_score}%
                  </p>
                  {quizEnrollment && quizEnrollment.attempts + 1 < 3 ? (
                    <Button variant="outline" onClick={() => {
                      setQuizStep('intro');
                      setCurrentQ(0);
                      setAnswers({});
                      setQuizResult(null);
                    }}>
                      🔄 Retry
                    </Button>
                  ) : (
                    <p className="text-sm text-destructive font-medium">Maximum attempts reached. Contact your supervisor.</p>
                  )}
                  {/* Show correct answers */}
                  <div className="mt-4 text-left space-y-3 px-4">
                    {quizQuestions.map((q, i) => {
                      const selectedIdx = answers[q.id];
                      const correctIdx = q.options.findIndex(o => o.is_correct);
                      const isCorrect = selectedIdx === correctIdx;
                      return (
                        <div key={q.id} className="text-xs border rounded p-2">
                          <p className="font-medium">{i + 1}. {q.question_text}</p>
                          <p className={isCorrect ? 'text-emerald-700' : 'text-destructive'}>
                            Your answer: {selectedIdx !== undefined ? q.options[selectedIdx]?.text : 'Skipped'}
                            {!isCorrect && ` → Correct: ${q.options[correctIdx]?.text}`}
                          </p>
                          {q.explanation && <p className="text-muted-foreground mt-1">💡 {q.explanation}</p>}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══════ CERTIFICATE MODAL ═══════ */}
      <Dialog open={certOpen} onOpenChange={setCertOpen}>
        <DialogContent className="max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Certificate of Completion</DialogTitle>
          </DialogHeader>
          {certData && (
            <>
              <div id="certificate-content" className="cert border-4 border-double border-[#B8860B] rounded-lg p-8 text-center bg-white">
                <h1 className="text-2xl font-bold text-[#B8860B] tracking-widest mb-2">CERTIFICATE OF COMPLETION</h1>
                <p className="text-sm text-muted-foreground mb-4">This is to certify that</p>
                <p className="name text-2xl font-bold text-[#1A2F5A] mb-1">{certData.userName}</p>
                <p className="text-xs text-muted-foreground mb-4">Role: {certData.userRole}</p>
                <p className="text-sm text-muted-foreground mb-1">has successfully completed</p>
                <p className="course-name text-lg font-bold text-[#1A2F5A] mb-4">{certData.course.course_name}</p>
                <div className="text-xs text-muted-foreground space-y-1 mb-4">
                  <p>Date: {format(new Date(certData.cert.issued_at), 'dd/MM/yyyy')}</p>
                  <p>Valid until: {certData.cert.expires_at ? format(new Date(certData.cert.expires_at), 'dd/MM/yyyy') : 'Lifetime'}</p>
                  <p>Certificate No: {certData.cert.certificate_number}</p>
                </div>
                <p className="text-xs text-[#0E7B7B] font-bold">NABH Compliant Training</p>
              </div>
              <div className="flex gap-2 mt-3">
                <Button className="flex-1" onClick={printCertificate}>
                  <Printer className="h-4 w-4 mr-1" />Print Certificate
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══════ BULK ENROL MODAL ═══════ */}
      <Dialog open={bulkEnrolOpen} onOpenChange={setBulkEnrolOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bulk Enrol Staff</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Course</Label>
              <Select value={bulkCourseId} onValueChange={setBulkCourseId}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.course_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Enrol</Label>
              <Select value={bulkMode} onValueChange={(v: any) => setBulkMode(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff</SelectItem>
                  <SelectItem value="role">By Role</SelectItem>
                  <SelectItem value="department">By Department</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bulkMode === 'role' && (
              <Input placeholder="Role (e.g. nurse)" value={bulkRole} onChange={e => setBulkRole(e.target.value)} />
            )}
            {bulkMode === 'department' && (
              <Select value={bulkDept} onValueChange={setBulkDept}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <div>
              <Label className="text-xs">Due Date</Label>
              <Input type="date" value={bulkDueDate} onChange={e => setBulkDueDate(e.target.value)} />
            </div>
            <Button className="w-full" onClick={handleBulkEnrol}>Enrol Staff</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════ ADD COURSE MODAL ═══════ */}
      <Dialog open={addCourseOpen} onOpenChange={setAddCourseOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Custom Course</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Course Name</Label>
              <Input value={newCourse.course_name} onChange={e => setNewCourse(p => ({ ...p, course_name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={newCourse.category} onValueChange={v => setNewCourse(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['mandatory_annual','mandatory_biannual','mandatory_once','clinical','administrative','safety','compliance','custom'].map(c =>
                    <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Duration (min)</Label>
                <Input type="number" value={newCourse.duration_minutes} onChange={e => setNewCourse(p => ({ ...p, duration_minutes: +e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Pass Score (%)</Label>
                <Input type="number" value={newCourse.passing_score} onChange={e => setNewCourse(p => ({ ...p, passing_score: +e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Validity (months, 0=lifetime)</Label>
              <Input type="number" value={newCourse.validity_months} onChange={e => setNewCourse(p => ({ ...p, validity_months: +e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Target Roles (comma-separated)</Label>
              <Input value={newCourse.target_roles} onChange={e => setNewCourse(p => ({ ...p, target_roles: e.target.value }))} placeholder="nurse, doctor" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input value={newCourse.description} onChange={e => setNewCourse(p => ({ ...p, description: e.target.value }))} />
            </div>
            <Button className="w-full" onClick={handleAddCourse}>Create Course</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════ ADD QUESTIONS MODAL ═══════ */}
      <Dialog open={addQuestionsOpen} onOpenChange={setAddQuestionsOpen}>
        <DialogContent className="max-w-[550px]">
          <DialogHeader><DialogTitle>Add Quiz Question</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Course</Label>
              <Select value={questionCourseId} onValueChange={setQuestionCourseId}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.course_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Question</Label>
              <Input value={newQuestion.question_text} onChange={e => setNewQuestion(p => ({ ...p, question_text: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={newQuestion.question_type} onValueChange={v => {
                const opts = v === 'true_false'
                  ? [{ text: 'True', is_correct: true }, { text: 'False', is_correct: false }]
                  : [{ text: '', is_correct: true }, { text: '', is_correct: false }, { text: '', is_correct: false }, { text: '', is_correct: false }];
                setNewQuestion(p => ({ ...p, question_type: v, options: opts }));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcq">MCQ</SelectItem>
                  <SelectItem value="true_false">True/False</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Options (click radio to mark correct)</Label>
              {newQuestion.options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="correct_option"
                    checked={opt.is_correct}
                    onChange={() => setNewQuestion(p => ({
                      ...p,
                      options: p.options.map((o, i) => ({ ...o, is_correct: i === idx })),
                    }))}
                    className="h-4 w-4"
                  />
                  <Input
                    value={opt.text}
                    onChange={e => setNewQuestion(p => ({
                      ...p,
                      options: p.options.map((o, i) => i === idx ? { ...o, text: e.target.value } : o),
                    }))}
                    placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                    className="flex-1"
                    disabled={newQuestion.question_type === 'true_false'}
                  />
                </div>
              ))}
            </div>
            <div>
              <Label className="text-xs">Explanation (shown after answering)</Label>
              <Input value={newQuestion.explanation} onChange={e => setNewQuestion(p => ({ ...p, explanation: e.target.value }))} />
            </div>
            <Button className="w-full" onClick={handleAddQuestion}>Add Question</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════ CELL DETAIL MODAL ═══════ */}
      <Dialog open={cellDetailOpen} onOpenChange={setCellDetailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cellDetail?.deptName} — {cellDetail?.courseName}</DialogTitle>
          </DialogHeader>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-2 text-left font-medium">Staff</th>
                  <th className="p-2 text-left font-medium">Status</th>
                  <th className="p-2 text-left font-medium">Completed</th>
                  <th className="p-2 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {cellDetail?.staff.map((s: any, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2">
                      <Badge variant="outline" className={`text-[10px] ${
                        s.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                        s.status === 'not_enrolled' ? 'bg-muted text-muted-foreground' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {s.status.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="p-2">{s.completed_at ? format(new Date(s.completed_at), 'dd/MM/yy') : '—'}</td>
                    <td className="p-2 text-right font-mono">{s.score != null ? `${s.score}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
