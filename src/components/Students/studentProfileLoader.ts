const importStudentProfileModule = () => import('./StudentProfilePage');

let studentProfileModulePromise: ReturnType<typeof importStudentProfileModule> | null = null;

export const loadStudentProfileModule = () => {
  studentProfileModulePromise ??= importStudentProfileModule();
  return studentProfileModulePromise;
};

export const prefetchStudentProfile = () => {
  void loadStudentProfileModule();
};
