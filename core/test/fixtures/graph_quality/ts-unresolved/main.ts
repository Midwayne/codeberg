import * as external from 'uninstalled-package';
export function run(value: any) {
  external.save(); // calls:-
  value.save(); // calls:-
}
