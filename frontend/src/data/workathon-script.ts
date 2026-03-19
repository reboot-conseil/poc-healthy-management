export interface WorkathonStep {
  id: string;
  title: string;
  /** Description of the step, read aloud by TTS when the step starts. */
  description: string;
  /** Duration in minutes. */
  duration: number;
}

export const DEFAULT_SCRIPT: WorkathonStep[] = [
  {
    id: 'cadrage',
    title: 'Cadrage',
    description:
      'Bienvenue dans cette session de workathon. Commençons par le cadrage. ' +
      'Présentez le contexte, les enjeux et les objectifs de la journée. ' +
      'Chaque participant doit repartir avec une compréhension claire du défi à relever.',
    duration: 5,
  },
  {
    id: 'tour-de-table',
    title: 'Tour de table',
    description:
      'Passons au tour de table. ' +
      'Chaque participant se présente : son prénom, son rôle, et une attente ou une contrainte pour cette session. ' +
      'Soyez concis, deux à trois phrases suffisent.',
    duration: 5,
  },
  {
    id: 'ideation',
    title: 'Idéation',
    description:
      'Place à l\'idéation. ' +
      'Brainstorming ouvert : toutes les idées sont les bienvenues, aucun jugement à ce stade. ' +
      'Privilégiez la quantité à la qualité pour l\'instant. Notez chaque idée sur un post-it ou un outil collaboratif.',
    duration: 15,
  },
  {
    id: 'selection',
    title: 'Vote et sélection',
    description:
      'Il est temps de voter et de sélectionner. ' +
      'Chaque participant dispose de trois votes à répartir librement sur les idées proposées. ' +
      'Retenez les deux ou trois idées qui recueillent le plus de soutien.',
    duration: 5,
  },
  {
    id: 'prototypage',
    title: 'Prototypage',
    description:
      'Nous entrons dans la phase de prototypage rapide. ' +
      'Par équipe, esquissez votre solution : maquette papier, schéma, storyboard ou prototype numérique. ' +
      'L\'objectif est de rendre votre idée tangible et communicable en quelques minutes.',
    duration: 20,
  },
  {
    id: 'pitch',
    title: 'Pitch et restitution',
    description:
      'Dernière étape : le pitch. ' +
      'Chaque équipe présente sa solution en trois minutes maximum. ' +
      'Expliquez le problème adressé, votre solution, et ce qu\'il faudrait pour la concrétiser.',
    duration: 10,
  },
];
